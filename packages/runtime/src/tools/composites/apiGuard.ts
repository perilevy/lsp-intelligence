import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { defineTool } from '../registry.js';
import { relativePath, uriToPath, getPackageName } from '../../engine/positions.js';
import { parseSourceContent } from '../../analysis/ts/parseSourceFile.js';
import { extractExports } from '../../analysis/ts/extractExports.js';
import { extractDeclarationShape } from '../../analysis/ts/extractDeclarationShape.js';
import { diffExportSets } from '../../analysis/ts/diffDeclarationShape.js';
import type { DeclRisk } from '../../analysis/ts/diffDeclarationShape.js';
import type { DeclarationDiff } from '../../analysis/ts/diffDeclarationShape.js';

// Local type aliases for the public api_guard output contract
export type ApiRiskLevel = DeclRisk;
export type ApiChangeKind = DeclarationDiff['kind'];

import { getMergeBase } from '../../git/getMergeBase.js';
import { getChangedFiles } from '../../git/getChangedFiles.js';
import { getBaseFileContent } from '../../git/getBaseFileContent.js';
import type { Location } from 'vscode-languageserver-protocol';
import { LspError, LspErrorCode, DEFAULT_TIMEOUTS } from '../../engine/types.js';
import { collectScopeFiles } from '../../resolve/searchScope.js';
import { programManager } from '../../analysis/ts/program/ProgramManager.js';
import { CheckerQueries } from '../../analysis/ts/program/CheckerQueries.js';
import { findNonExhaustiveSwitches, predictAddedMemberImpact } from '../../analysis/ts/exhaustiveness.js';
import { analyzeCallSiteCompatibility } from '../../analysis/ts/compatibility.js';

// --- Structured output types ---

interface ApiGuardEntry {
  exportName: string;
  filePath: string;
  line?: number;
  declarationKind?: string;
  kind: ApiChangeKind;
  risk: ApiRiskLevel;
  reason: string;
  currentSignature?: string;
  baseSignature?: string;
  structuralDiff?: string[];
  consumers: { samePackage: number; crossPackage: number; sampleFiles: string[] };
  diagnosticsInConsumers?: number;
  evidence: string[];
  /** Phase 3C: actionable migration guidance for this change */
  migrationSteps: string[];
  /** Phase 3C: files likely needing updates based on consumer analysis */
  filesToInspect: string[];
}

interface ApiGuardResult {
  summary: {
    exportsChecked: number;
    changedExports: number;
    breaking: number;
    risky: number;
    safe: number;
    recommendedSemver: 'major' | 'minor' | 'patch';
  };
  entries: ApiGuardEntry[];
  stats: {
    astUsed: boolean;
    filesParsed: number;
    baseUsed: boolean;
    partialResult: boolean;
  };
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Phase 3C: Migration step generation
// ---------------------------------------------------------------------------

function generateMigrationSteps(
  exportName: string,
  kind: string,
  diffs: Array<{ kind: string; reason: string; details: string[] }>,
): string[] {
  const steps: string[] = [];
  const d = diffs[0];

  switch (kind) {
    case 'removed':
      steps.push(`Remove all imports of \`${exportName}\` — it no longer exists`);
      steps.push(`Find replacement or implement the functionality at each call site`);
      break;

    case 'renamed':
      steps.push(`Update all imports and usages to the new name`);
      break;

    case 'param_required': {
      const paramMatch = d?.reason.match(/"([^"]+)"/);
      const paramName = paramMatch?.[1] ?? 'newParam';
      steps.push(`Add the required \`${paramName}\` argument to all callers of \`${exportName}\``);
      steps.push(`Search for \`${exportName}(\` to find call sites needing updates`);
      break;
    }

    case 'param_added':
      steps.push(`No immediate action required — new parameter is optional`);
      steps.push(`Callers can opt in to the new \`${diffs[0]?.details?.[0] ?? 'param'}\` parameter as needed`);
      break;

    case 'param_removed': {
      const paramMatch = d?.reason.match(/"([^"]+)"/);
      steps.push(`Remove the \`${paramMatch?.[1] ?? 'param'}\` argument from all callers of \`${exportName}\``);
      break;
    }

    case 'return_type_changed':
      steps.push(`Check all code that assigns or destructures the return value of \`${exportName}\``);
      steps.push(`Update variable types or add explicit casts where needed`);
      break;

    case 'interface_shape_changed':
      if (d?.reason.includes('required') || d?.reason.includes('Required')) {
        const propMatch = d?.reason.match(/"([^"]+)"/);
        steps.push(`Add the required \`${propMatch?.[1] ?? 'property'}\` field to all objects implementing \`${exportName}\``);
      } else if (d?.reason.includes('removed') || d?.reason.includes('Removed')) {
        const propMatch = d?.reason.match(/"([^"]+)"/);
        steps.push(`Remove references to the deleted \`${propMatch?.[1] ?? 'property'}\` property from all usages`);
      } else {
        steps.push(`Update all objects implementing the \`${exportName}\` interface`);
      }
      break;

    case 'enum_member_removed': {
      const memberMatch = d?.reason.match(/"([^"]+)"/);
      steps.push(`Replace all usages of the removed \`${exportName}.${memberMatch?.[1] ?? 'member'}\` value`);
      steps.push(`Check switch statements over \`${exportName}\` — some may now have dead code`);
      break;
    }

    case 'enum_member_added': {
      const memberMatch = d?.reason.match(/"([^"]+)"/);
      steps.push(`Add handling for the new \`${exportName}.${memberMatch?.[1] ?? 'member'}\` value in exhaustive switch statements`);
      break;
    }

    default:
      steps.push(`Review all usages of \`${exportName}\` and update as needed`);
  }

  return steps;
}

// File collection uses shared searchScope (supports JS/TS/JSX/MJS/CJS)

export const apiGuard = defineTool({
  name: 'api_guard',
  description: 'Detect public API contract changes: what exports changed, how they changed structurally, who consumes them, and the semver impact. Use before merging to catch accidental breaking changes.',
  schema: z.object({
    base: z.string().optional().describe('Git base ref. Defaults to merge-base with main.'),
    scope: z.enum(['changed', 'all']).default('changed').describe('"changed" = only diff-modified files, "all" = scan all source files'),
    symbol: z.string().optional().describe('Optional: narrow to a specific export name'),
    file_path: z.string().optional().describe('Optional: narrow to a specific file'),
  }),
  async handler(params, engine) {
    if (!engine.gitAvailable && params.scope === 'changed') {
      throw new LspError(LspErrorCode.GIT_UNAVAILABLE, 'Git required for scope "changed". Use scope "all" instead.');
    }

    const timeout = DEFAULT_TIMEOUTS.composite;
    const warnings: string[] = [];
    let astUsed = false;

    // Step 0: Resolve base ref
    const base = engine.gitAvailable ? getMergeBase(engine.workspaceRoot, params.base) : undefined;

    // Step 1: Get files in scope
    let scopeFiles: string[];
    if (params.file_path) {
      scopeFiles = [params.file_path];
    } else if (params.scope === 'changed' && base) {
      scopeFiles = getChangedFiles(engine.workspaceRoot, base);
    } else {
      scopeFiles = collectScopeFiles({ roots: [engine.workspaceRoot], includeTests: false }, 500);
    }

    if (scopeFiles.length === 0) {
      return { summary: { exportsChecked: 0, changedExports: 0, breaking: 0, risky: 0, safe: 0, recommendedSemver: 'patch' as const }, entries: [], stats: { astUsed: false, filesParsed: 0, baseUsed: !!base, partialResult: false }, warnings: ['No files in scope'] } satisfies ApiGuardResult;
    }

    // Step 2+3: Parse exports, diff
    const entries: ApiGuardEntry[] = [];
    let filesParsed = 0;
    let totalExportsChecked = 0;

    for (const filePath of scopeFiles) {
      try {
        const currentContent = fs.readFileSync(filePath, 'utf-8');
        const currentSf = parseSourceContent(currentContent, filePath);
        astUsed = true;
        const currentExports = extractExports(currentSf);
        const currentShapes = currentExports.map((e) => extractDeclarationShape(currentSf, e));
        totalExportsChecked += currentShapes.length;

        // Get base shapes
        let baseShapes: ReturnType<typeof extractDeclarationShape>[] = [];
        if (base) {
          const baseContent = getBaseFileContent(filePath, base, engine.workspaceRoot);
          if (baseContent) {
            const baseSf = parseSourceContent(baseContent, filePath);
            const baseExports = extractExports(baseSf);
            baseShapes = baseExports.map((e) => extractDeclarationShape(baseSf, e));
          }
        }

        const diffs = diffExportSets(baseShapes, currentShapes);
        for (const d of diffs) {
          if (params.symbol && d.name !== params.symbol) continue;

          // Aggregate reason and structural details across all per-declaration diffs
          const reason = d.diffs.map((dd) => dd.reason).join('; ');
          const structuralDiff = d.diffs.flatMap((dd) => dd.details);

          entries.push({
            exportName: d.name,
            filePath,
            line: d.currentShape?.line ?? d.baseShape?.line,
            declarationKind: d.baseShape?.kind ?? d.currentShape?.kind,
            kind: d.diffs[0]?.kind ?? (d.status === 'added' ? 'added' : d.status === 'removed' ? 'removed' : 'signature_changed'),
            risk: d.risk,
            reason,
            currentSignature: d.currentShape?.signatureText,
            baseSignature: d.baseShape?.signatureText,
            structuralDiff,
            consumers: { samePackage: 0, crossPackage: 0, sampleFiles: [] },
            evidence: [],
            migrationSteps: generateMigrationSteps(d.name, d.diffs[0]?.kind ?? d.status, d.diffs),
            filesToInspect: [],
          });
        }
        filesParsed++;
      } catch {}
    }

    // Step 3b: Semantic enrichment via Phase 2C TypeScript checker
    // Adds precise type information for changed params/returns — goes beyond AST text.
    if (entries.length > 0) {
      try {
        const tsProgram = programManager.getOrBuild(engine.workspaceRoot);
        const queries = new CheckerQueries(tsProgram);

        for (const entry of entries) {
          // Phase 2C: enrich with checker-verified type information
          if (entry.kind === 'param_required' || entry.kind === 'param_added' || entry.kind === 'return_type_changed') {
            const params = queries.getFunctionParams(entry.filePath, entry.exportName);
            if (params) {
              const paramDesc = params.map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.typeText}`).join(', ');
              entry.evidence.push(`checker: signature (${paramDesc})`);
            }
          }

          // Phase 2D: exhaustiveness intelligence for enum changes
          if (entry.kind === 'enum_member_removed') {
            const members = queries.getEnumMembers(entry.filePath, entry.exportName);
            if (members) entry.evidence.push(`checker: remaining members [${members.join(', ')}]`);
            const nonExhaustive = findNonExhaustiveSwitches(tsProgram, entry.filePath, entry.exportName);
            if (nonExhaustive.length > 0) {
              const files = [...new Set(nonExhaustive.map((s) => relativePath(s.filePath, engine.workspaceRoot)))].slice(0, 3).join(', ');
              entry.evidence.push(`exhaustiveness: ${nonExhaustive.length} non-exhaustive switch(es) → ${files}`);
              // Escalate risk: non-exhaustive switches mean more callers are broken
              if (entry.risk !== 'breaking') entry.risk = 'breaking';
            }
          }

          if (entry.kind === 'enum_member_added') {
            const members = queries.getEnumMembers(entry.filePath, entry.exportName);
            if (members) entry.evidence.push(`checker: all members [${members.join(', ')}]`);
            const impact = predictAddedMemberImpact(tsProgram, entry.filePath, entry.exportName, 'new');
            if (impact.affectedSwitches.length > 0) {
              const files = [...new Set(impact.affectedSwitches.map((s) => relativePath(s.filePath, engine.workspaceRoot)))].slice(0, 3).join(', ');
              entry.evidence.push(`exhaustiveness: ${impact.affectedSwitches.length} switch(es) without default will miss new member → ${files}`);
              // Enum member additions are risky (not safe) when switches are affected
              if (entry.risk === 'safe') entry.risk = 'risky';
            }
          }

          // Phase 2D: call-site compatibility for required param changes
          if (entry.kind === 'param_required' && entry.risk === 'breaking') {
            const paramFacts = queries.getFunctionParams(entry.filePath, entry.exportName);
            if (paramFacts) {
              const required = paramFacts.filter((p) => !p.optional && !p.rest).length;
              const max = paramFacts.length;
              const report = analyzeCallSiteCompatibility(tsProgram, entry.filePath, entry.exportName, required, max);
              if (report.breakingCallers.length > 0) {
                const files = [...new Set(report.breakingCallers.map((c) => relativePath(c.filePath, engine.workspaceRoot)))].slice(0, 3).join(', ');
                entry.evidence.push(`compatibility: ${report.breakingCallers.length} breaking call site(s) → ${files}`);
              }
            }
          }
        }
      } catch {
        // Checker enrichment is best-effort — never block on failures
      }
    }

    // Step 4: Find consumers using declaration line data (no raw text rescanning)
    let consumerChecks = 0;
    for (const entry of entries.filter((e) => e.risk !== 'safe')) {
      if (consumerChecks >= 15) { warnings.push('Consumer lookup capped at 15 entries'); break; }
      try {
        const { uri } = await engine.prepareFile(entry.filePath);
        const exportLine0 = Math.max(0, (entry.line ?? 1) - 1);

        const refs = await engine.request<Location[] | null>(
          'textDocument/references', {
            textDocument: { uri },
            position: { line: exportLine0, character: 0 },
            context: { includeDeclaration: false },
          }, timeout,
        ).catch((err: unknown) => { warnings.push(`Consumer lookup failed for ${entry.exportName}: ${err instanceof Error ? err.message : String(err)}`); return null; });

        if (refs) {
          const currentPkg = getPackageName(entry.filePath);
          const samePackage = refs.filter((r) => getPackageName(uriToPath(r.uri)) === currentPkg).length;
          const crossPackage = refs.length - samePackage;
          const sampleFiles = [...new Set(refs.map((r) => relativePath(uriToPath(r.uri), engine.workspaceRoot)))].slice(0, 5);
          entry.consumers = { samePackage, crossPackage, sampleFiles };
          entry.filesToInspect = sampleFiles.filter((f) => !f.includes('node_modules'));
          entry.evidence.push(`${crossPackage} cross-package, ${samePackage} same-package consumers`);

          // Populate diagnosticsInConsumers (sample up to 3 consumer files)
          let diagCount = 0;
          for (const fp of sampleFiles.slice(0, 3)) {
            try {
              const abs = fp.startsWith('/') ? fp : `${engine.workspaceRoot}/${fp}`;
              const { uri: consumerUri } = await engine.prepareFile(abs);
              const { waitForDiagnostics: waitDiag } = await import('../../engine/waitForDiagnostics.js');
              await waitDiag(engine.docManager, consumerUri, 500);
              diagCount += engine.docManager.getCachedDiagnostics(consumerUri).filter((d: any) => d.severity === 1).length;
            } catch (err) {
              warnings.push(`Consumer diagnostics failed for ${fp}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
          entry.diagnosticsInConsumers = diagCount;

          // Downgrade risk if no cross-package consumers
          if (crossPackage === 0 && entry.risk === 'risky') {
            entry.risk = 'safe';
            entry.reason += ' (no cross-package consumers)';
          }
        }
        consumerChecks++;
      } catch (err) {
        warnings.push(`Consumer analysis failed for ${entry.exportName}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Step 5: Classify and summarize
    const breaking = entries.filter((e) => e.risk === 'breaking').length;
    const risky = entries.filter((e) => e.risk === 'risky').length;
    const safe = entries.filter((e) => e.risk === 'safe').length;
    // Semver: breaking → major, additive-only (new export or new optional param) → minor, else patch
    const hasAdditive = entries.some((e) => (e.kind === 'added' || e.kind === 'param_added') && e.risk === 'safe');
    const semver: 'major' | 'minor' | 'patch' = breaking > 0 ? 'major' : hasAdditive ? 'minor' : 'patch';

    const result: ApiGuardResult = {
      summary: {
        exportsChecked: totalExportsChecked,
        changedExports: entries.length,
        breaking,
        risky,
        safe,
        recommendedSemver: semver,
      },
      entries: entries.sort((a, b) => {
        const riskOrder = { breaking: 0, risky: 1, safe: 2 };
        return riskOrder[a.risk] - riskOrder[b.risk];
      }),
      stats: {
        astUsed,
        filesParsed,
        baseUsed: !!base,
        partialResult: consumerChecks >= 15,
      },
      warnings,
    };

    return result;
  },
});
