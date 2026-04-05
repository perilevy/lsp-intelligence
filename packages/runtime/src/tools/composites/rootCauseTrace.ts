import { z } from 'zod';
import * as fs from 'fs';
import { defineTool } from '../registry.js';
import { relativePath, uriToPath, pathToUri, fromPosition } from '../../engine/positions.js';
import { formatHover } from '../../format/markdown.js';
import { parseFile } from '../../ast/parseFile.js';
import { classifyErrorSite } from '../../ast/findNodeAtPosition.js';
import { parseSourceContent } from '../../analysis/ts/parseSourceFile.js';
import { extractExports } from '../../analysis/ts/extractExports.js';
import { extractDeclarationShape } from '../../analysis/ts/extractDeclarationShape.js';
import { diffExportSets } from '../../analysis/ts/diffDeclarationShape.js';
import { getMergeBase } from '../../git/getMergeBase.js';
import { getBaseFileContent } from '../../git/getBaseFileContent.js';
import { fileChangedInBranch } from '../../git/getChangedHunks.js';
import { programManager } from '../../analysis/ts/program/ProgramManager.js';
import { getAllSwitchResults } from '../../analysis/ts/exhaustiveness.js';
import { resolveTarget, pickDiagnostic, type ToolTargetInput } from '../../resolve/targetResolver.js';
import type { Location, Hover, CallHierarchyItem, CallHierarchyIncomingCall } from 'vscode-languageserver-protocol';
import { DEFAULT_TIMEOUTS } from '../../engine/types.js';

interface RootCauseCandidate {
  symbol?: string;
  declarationKind?: string;
  filePath: string;
  line?: number;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
  score: number;
  evidence: string[];
  changedInBranch: boolean;
  structuralChange?: string;
  diagnosticsNearby?: number;
  impactSummary?: { affectedFiles: number };
  suggestedFix?: string;
}

interface RootCauseTraceResult {
  diagnostic?: { code?: string; message: string; filePath: string; line: number };
  errorSite: {
    symbol?: string;
    definitionFile?: string;
    enclosingNodeKind?: string;
    localPattern?: string;
    hoverSummary?: string;
  };
  candidates: RootCauseCandidate[];
  topCandidate?: RootCauseCandidate;
  nextVerificationStep?: string;
  stats: { candidatesConsidered: number; callerFilesChecked: number; astUsed: boolean; baseUsed: boolean; partialResult: boolean };
  warnings: string[];
}

export const rootCauseTrace = defineTool({
  name: 'root_cause_trace',
  description: 'Trace the root cause of a TypeScript error. Accepts symbol name, file+line, or file+diagnostic_code. Identifies the originating declaration change with evidence chain.',
  schema: z.object({
    symbol: z.string().optional().describe('Symbol at or near the error site'),
    file_path: z.string().optional().describe('File containing the error'),
    line: z.number().optional().describe('1-indexed line number'),
    diagnostic_code: z.string().optional().describe('Diagnostic code, e.g. TS2345'),
    base: z.string().optional().describe('Git base ref'),
  }),
  async handler(params, engine) {
    const timeout = DEFAULT_TIMEOUTS.composite;
    const warnings: string[] = [];
    let astUsed = false;

    // Step 1: Resolve target via shared resolver (symbol-first)
    let target;
    try {
      target = await resolveTarget(params as ToolTargetInput, engine);
    } catch (err) {
      return { errorSite: {}, candidates: [], stats: { candidatesConsidered: 0, callerFilesChecked: 0, astUsed: false, baseUsed: false, partialResult: false }, warnings: [`Target resolution failed: ${err instanceof Error ? err.message : String(err)}`] } satisfies RootCauseTraceResult;
    }

    const { filePath, uri, position: targetPosition, symbol: symbolName } = target;

    // Step 2: Anchor the diagnostic (poll for readiness instead of fixed sleep)
    const { waitForDiagnostics } = await import('../../engine/waitForDiagnostics.js');
    await waitForDiagnostics(engine.docManager, uri, 800);
    const allDiags = engine.docManager.getCachedDiagnostics(uri);
    const targetDiag = pickDiagnostic(allDiags, targetPosition, params.diagnostic_code);

    if (!targetDiag) {
      return { errorSite: { symbol: symbolName }, candidates: [], stats: { candidatesConsidered: 0, callerFilesChecked: 0, astUsed: false, baseUsed: false, partialResult: false }, warnings: [`No error diagnostic in ${relativePath(filePath, engine.workspaceRoot)}`] } satisfies RootCauseTraceResult;
    }

    const base = engine.gitAvailable ? getMergeBase(engine.workspaceRoot, params.base) : undefined;
    const errorPosition = targetDiag.range.start;
    const diagPos = fromPosition(errorPosition);

    // Step 3: Error site — LSP + AST (with proper error handling)
    const [hoverResult, defResult] = await Promise.all([
      engine.request<Hover | null>('textDocument/hover', { textDocument: { uri }, position: errorPosition }, timeout)
        .catch((err) => { warnings.push(`Hover failed: ${err instanceof Error ? err.message : String(err)}`); return null; }),
      engine.request<Location | Location[] | null>('textDocument/definition', { textDocument: { uri }, position: errorPosition }, timeout)
        .catch((err) => { warnings.push(`Definition lookup failed: ${err instanceof Error ? err.message : String(err)}`); return null; }),
    ]);

    let localPattern: string | null = null;
    try {
      const root = parseFile(filePath);
      if (root) { astUsed = true; localPattern = classifyErrorSite(root, errorPosition.line); }
    } catch (err) {
      warnings.push(`AST classification failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const hoverSummary = hoverResult ? formatHover(hoverResult).substring(0, 200) : undefined;
    const firstDef = Array.isArray(defResult) ? defResult[0] : defResult;
    const defLocation = firstDef ? uriToPath(firstDef.uri) : undefined;

    const errorSite = {
      symbol: symbolName,
      definitionFile: defLocation ? relativePath(defLocation, engine.workspaceRoot) : undefined,
      enclosingNodeKind: localPattern ?? undefined,
      localPattern: localPattern ?? undefined,
      hoverSummary,
    };

    // Step 4: Collect candidates
    const candidates: RootCauseCandidate[] = [];

    // Candidate A: definition site
    if (defLocation && defLocation !== filePath) {
      candidates.push(await buildCandidate(defLocation, 'definition-site', 5, base, engine, warnings));
    }

    // Candidate B: type definition
    try {
      const typeDef = await engine.request<Location | Location[] | null>(
        'textDocument/typeDefinition', { textDocument: { uri }, position: errorPosition }, timeout,
      );
      const firstTypeDef = Array.isArray(typeDef) ? typeDef[0] : typeDef;
      if (firstTypeDef) {
        const typeDefPath = uriToPath(firstTypeDef.uri);
        if (typeDefPath !== filePath && typeDefPath !== defLocation) {
          candidates.push(await buildCandidate(typeDefPath, 'type-definition', 4, base, engine, warnings));
        }
      }
    } catch (err) {
      warnings.push(`Type definition lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Candidate C: upstream callers (cap at 5)
    let callerFilesChecked = 0;
    try {
      const items = await engine.request<CallHierarchyItem[] | null>(
        'textDocument/prepareCallHierarchy', { textDocument: { uri }, position: errorPosition }, timeout,
      );
      if (items?.length) {
        const incomingCalls = await engine.request<CallHierarchyIncomingCall[] | null>(
          'callHierarchy/incomingCalls', { item: items[0] }, timeout,
        );
        for (const call of (incomingCalls ?? []).slice(0, 5)) {
          const callerPath = uriToPath(call.from.uri);
          if (callerPath === filePath) continue;
          try {
            const changed = base ? fileChangedInBranch(callerPath, base, engine.workspaceRoot) : false;
            await engine.prepareFile(callerPath);
            await waitForDiagnostics(engine.docManager, pathToUri(callerPath), 500);
            const callerDiags = engine.docManager.getCachedDiagnostics(pathToUri(callerPath)).filter((d) => d.severity === 1).length;

            let score = 2;
            const evidence: string[] = [`upstream-caller: ${relativePath(callerPath, engine.workspaceRoot)}`];
            if (changed) { score += 6; evidence.push('changed-in-branch'); }
            if (callerDiags > 0) { score += 3; evidence.push(`caller-has-errors: ${callerDiags}`); }

            candidates.push({
              symbol: call.from.name, filePath: callerPath,
              reason: changed ? `Upstream caller changed${callerDiags ? ` (${callerDiags} errors)` : ''}` : `Upstream caller${callerDiags ? ` with ${callerDiags} errors` : ''}`,
              confidence: changed && callerDiags > 0 ? 'high' : 'low',
              score, evidence, changedInBranch: changed, diagnosticsNearby: callerDiags,
            });
          } catch (err) {
            warnings.push(`Caller analysis failed for ${call.from.name}: ${err instanceof Error ? err.message : String(err)}`);
          }
          callerFilesChecked++;
        }
      }
    } catch (err) {
      warnings.push(`Call hierarchy failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Step 5: Rank + impact
    const sorted = candidates.sort((a, b) => b.score - a.score);
    const topCandidate = sorted[0];

    if (topCandidate) {
      try {
        if (topCandidate.symbol) {
          const resolved = await engine.resolveSymbol(topCandidate.symbol, topCandidate.filePath);
          const refs = await engine.request<Location[] | null>(
            'textDocument/references', { textDocument: { uri: resolved.uri }, position: resolved.position, context: { includeDeclaration: false } }, timeout,
          );
          if (refs) topCandidate.impactSummary = { affectedFiles: new Set(refs.map((r) => uriToPath(r.uri))).size };
        }
      } catch (err) {
        warnings.push(`Impact analysis failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      if (localPattern === 'unhandled_enum_member') topCandidate.suggestedFix = 'Add a case for the new enum member';
      else if (localPattern === 'bad_call_argument') topCandidate.suggestedFix = 'Check function signature — a parameter type may have changed';
      else if (localPattern === 'missing_property_access') topCandidate.suggestedFix = 'A property may have been removed or renamed';
      else if (localPattern === 'incompatible_assignment') topCandidate.suggestedFix = 'Source type may have changed — check the definition';
    }

    return {
      diagnostic: { code: targetDiag.code ? `TS${targetDiag.code}` : undefined, message: targetDiag.message, filePath, line: diagPos.line },
      errorSite,
      candidates: sorted,
      topCandidate,
      nextVerificationStep: topCandidate ? buildNextStep(topCandidate, engine.workspaceRoot) : undefined,
      stats: { candidatesConsidered: candidates.length, callerFilesChecked, astUsed, baseUsed: !!base, partialResult: callerFilesChecked >= 5 },
      warnings,
    } satisfies RootCauseTraceResult;
  },
});

/**
 * Phase 3C: Generate a specific, actionable next-verification step based on
 * what the root cause analysis found. Goes beyond the generic "run impact_trace"
 * to tell the developer exactly what to check.
 */
function buildNextStep(candidate: RootCauseCandidate, workspaceRoot: string): string {
  const relPath = relativePath(candidate.filePath, workspaceRoot);
  const sc = candidate.structuralChange ?? '';

  // Param change → find callers
  if (sc.includes('param_required')) {
    const match = sc.match(/param_required:\s*(\w+)/);
    const func = match?.[1];
    return func
      ? `Find all callers of \`${func}\` — some will need a new required argument`
      : `Check all callers of the changed function in ${relPath}`;
  }
  if (sc.includes('param_removed')) {
    return `Check all call sites in files that import from ${relPath} — a parameter was removed`;
  }

  // Enum change → check switch statements
  if (sc.includes('enum_member_removed')) {
    const match = sc.match(/enum_member_removed:\s*(\w+)/);
    return match
      ? `Find all switch statements and comparisons using \`${match[1]}\` — the removed member may be referenced`
      : `Check switch statements over the changed enum in files importing from ${relPath}`;
  }
  if (sc.includes('enum_member_added')) {
    const match = sc.match(/enum_member_added:\s*(\w+)/);
    return match
      ? `Check exhaustive switch statements over \`${match[1]}\` — they may need a new case`
      : `Check exhaustive switch statements in files importing from ${relPath}`;
  }

  // Interface change → find implementors
  if (sc.includes('interface_shape_changed')) {
    return `Find all objects implementing the changed interface in ${relPath} and update required fields`;
  }

  // Return type change → check callers
  if (sc.includes('return_type_changed')) {
    return `Check code that uses the return value from the changed function in ${relPath}`;
  }

  // Generic removal
  if (sc.includes('removed')) {
    return `Find all imports of the removed export in ${relPath} and update them`;
  }

  // Fallback
  return `Run impact_trace on ${relPath} to find all affected files`;
}

async function buildCandidate(
  candidatePath: string,
  source: string,
  baseScore: number,
  base: string | undefined,
  engine: any,
  warnings: string[],
): Promise<RootCauseCandidate> {
  const changed = base ? fileChangedInBranch(candidatePath, base, engine.workspaceRoot) : false;
  let score = baseScore;
  const evidence: string[] = [`${source}: ${relativePath(candidatePath, engine.workspaceRoot)}`];
  let structuralChange: string | undefined;

  if (changed) {
    score += 8;
    evidence.push('changed-in-branch');
    if (base) {
      try {
        const sc = classifyDeclarationChange(candidatePath, base, engine.workspaceRoot);
        if (sc) {
          score += 5;
          evidence.push(`structural-change: ${sc}`);
          structuralChange = sc;

          // Phase 2D: for enum changes, find affected switches in the workspace
          if (sc.includes('enum_member')) {
            try {
              const tsProgram = programManager.getOrBuild(engine.workspaceRoot);
              // Extract the enum name from the structural change string (e.g. "enum_member_removed: ItemStatus")
              const enumMatch = sc.match(/enum_member_(?:removed|added):\s*(\w+)/);
              if (enumMatch) {
                const enumName = enumMatch[1];
                const switches = getAllSwitchResults(tsProgram, candidatePath, enumName);
                const nonExhaustive = switches.filter((s) => !s.isExhaustive);
                if (nonExhaustive.length > 0) {
                  score += 3;
                  const fileList = [...new Set(nonExhaustive.map((s) => relativePath(s.filePath, engine.workspaceRoot)))].slice(0, 2).join(', ');
                  evidence.push(`exhaustiveness: ${nonExhaustive.length} affected switch(es) → ${fileList}`);
                }
              }
            } catch {
              // Exhaustiveness enrichment is best-effort
            }
          }
        }
      } catch (err) {
        warnings.push(`Structural classification failed for ${relativePath(candidatePath, engine.workspaceRoot)}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return {
    filePath: candidatePath,
    reason: changed ? `${source} changed in this branch` : `${source} — trace upstream`,
    confidence: changed ? 'high' : source === 'definition-site' ? 'medium' : 'low',
    score, evidence, changedInBranch: changed, structuralChange,
  };
}

function classifyDeclarationChange(filePath: string, base: string, workspaceRoot: string): string | null {
  const baseContent = getBaseFileContent(filePath, base, workspaceRoot);
  if (!baseContent) return null;
  const currentContent = fs.readFileSync(filePath, 'utf-8');
  const baseSf = parseSourceContent(baseContent, filePath);
  const currentSf = parseSourceContent(currentContent, filePath);
  const baseShapes = extractExports(baseSf).map((e) => extractDeclarationShape(baseSf, e));
  const currentShapes = extractExports(currentSf).map((e) => extractDeclarationShape(currentSf, e));
  const diffs = diffExportSets(baseShapes, currentShapes);
  return diffs.length > 0
    ? diffs.map((d) => `${d.diffs[0]?.kind ?? d.status}: ${d.name}`).join(', ')
    : null;
}
