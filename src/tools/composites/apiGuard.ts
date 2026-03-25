import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { defineTool } from '../registry.js';
import { relativePath, uriToPath, getPackageName } from '../../engine/positions.js';
import { parseSource } from '../../ast/parseFile.js';
import { extractExportDeclarations } from '../../ast/extractExportDeclarations.js';
import { diffExportDeclarations } from '../../ast/diffDeclarationShapes.js';
import type { ApiRiskLevel, ApiChangeKind } from '../../ast/diffDeclarationShapes.js';
import { getMergeBase } from '../../git/getMergeBase.js';
import { getChangedFiles } from '../../git/getChangedFiles.js';
import { getBaseFileContent } from '../../git/getBaseFileContent.js';
import type { Location } from 'vscode-languageserver-protocol';
import { LspError, LspErrorCode, DEFAULT_TIMEOUTS, SKIP_DIRS } from '../../engine/types.js';

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

// --- Helper: collect all TS files under a dir ---

function collectTsFiles(dir: string, max: number): string[] {
  const files: string[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 6 || files.length >= max) return;
    try {
      for (const entry of fs.readdirSync(d)) {
        if (SKIP_DIRS.has(entry)) continue;
        const full = path.join(d, entry);
        if (fs.statSync(full).isDirectory()) walk(full, depth + 1);
        else if ((entry.endsWith('.ts') || entry.endsWith('.tsx')) && !entry.endsWith('.d.ts')) {
          files.push(full);
        }
      }
    } catch {}
  };
  walk(dir, 0);
  return files;
}

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
      scopeFiles = collectTsFiles(engine.workspaceRoot, 500);
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
        const currentRoot = parseSource(currentContent, filePath.endsWith('.tsx'));
        const currentExports = currentRoot
          ? (astUsed = true, extractExportDeclarations(currentRoot, currentContent))
          : extractExportDeclarations(null, currentContent);

        totalExportsChecked += currentExports.length;

        // Get base exports
        let baseExports = extractExportDeclarations(null, '');
        if (base) {
          const baseContent = getBaseFileContent(filePath, base, engine.workspaceRoot);
          if (baseContent) {
            const baseRoot = parseSource(baseContent, filePath.endsWith('.tsx'));
            baseExports = baseRoot
              ? extractExportDeclarations(baseRoot, baseContent)
              : extractExportDeclarations(null, baseContent);
          }
        }

        const diffs = diffExportDeclarations(baseExports, currentExports);
        for (const d of diffs) {
          if (params.symbol && d.name !== params.symbol) continue;

          entries.push({
            exportName: d.name,
            filePath,
            line: d.currentDecl?.line ?? d.baseDecl?.line,
            declarationKind: d.baseDecl?.declarationKind ?? d.currentDecl?.declarationKind,
            kind: d.kind,
            risk: d.risk,
            reason: d.reason,
            currentSignature: d.currentDecl?.signatureText,
            baseSignature: d.baseDecl?.signatureText,
            structuralDiff: d.structuralDiff,
            consumers: { samePackage: 0, crossPackage: 0, sampleFiles: [] },
            evidence: [],
          });
        }
        filesParsed++;
      } catch {}
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
          entry.evidence.push(`${crossPackage} cross-package, ${samePackage} same-package consumers`);

          // Populate diagnosticsInConsumers (sample up to 3 consumer files)
          let diagCount = 0;
          for (const fp of sampleFiles.slice(0, 3)) {
            try {
              const abs = fp.startsWith('/') ? fp : `${engine.workspaceRoot}/${fp}`;
              const { uri: consumerUri } = await engine.prepareFile(abs);
              await new Promise((r) => setTimeout(r, 300));
              diagCount += engine.docManager.getCachedDiagnostics(consumerUri).filter((d: any) => d.severity === 1).length;
            } catch {}
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
    // Semver: breaking → major, additive-only → minor, else patch
    const hasAdditive = entries.some((e) => e.kind === 'added' && e.risk === 'safe');
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
