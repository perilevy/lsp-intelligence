import { z } from 'zod';
import * as fs from 'fs';
import { defineTool } from '../registry.js';
import { relativePath, uriToPath, pathToUri, fromPosition } from '../../engine/positions.js';
import { formatHover } from '../../format/markdown.js';
import { parseFile, parseSource } from '../../ast/parseFile.js';
import { classifyErrorSite } from '../../ast/findNodeAtPosition.js';
import { extractExportDeclarations } from '../../ast/extractExportDeclarations.js';
import { diffExportDeclarations } from '../../ast/diffDeclarationShapes.js';
import { getMergeBase } from '../../git/getMergeBase.js';
import { getBaseFileContent } from '../../git/getBaseFileContent.js';
import { fileChangedInBranch } from '../../git/getChangedHunks.js';
import type { Location, Hover, Diagnostic, CallHierarchyItem, CallHierarchyIncomingCall } from 'vscode-languageserver-protocol';
import { DEFAULT_TIMEOUTS } from '../../engine/types.js';

// --- Structured output types ---

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
  impactSummary?: { affectedFiles: number; affectedSymbols?: number };
  suggestedFix?: string;
}

interface RootCauseTraceResult {
  diagnostic?: { code?: string; message: string; filePath: string; line: number };
  errorSite: {
    symbol?: string;
    definitionFile?: string;
    enclosingNodeKind?: string;
    localPattern?: string;
  };
  candidates: RootCauseCandidate[];
  topCandidate?: RootCauseCandidate;
  nextVerificationStep?: string;
  stats: {
    candidatesConsidered: number;
    callerFilesChecked: number;
    astUsed: boolean;
    baseUsed: boolean;
    partialResult: boolean;
  };
  warnings: string[];
}

export const rootCauseTrace = defineTool({
  name: 'root_cause_trace',
  description: 'Trace the root cause of a TypeScript error. Given a diagnostic location, identifies the most likely originating declaration change with an evidence chain. Best for type/interface/export/signature regressions.',
  schema: z.object({
    symbol: z.string().optional().describe('Symbol at the error site'),
    file_path: z.string().optional().describe('File with the error'),
    line: z.number().optional().describe('Error line (1-indexed). If omitted, uses first diagnostic.'),
    diagnostic_code: z.string().optional().describe('TS error code, e.g. "TS2345"'),
    base: z.string().optional().describe('Git base ref to check recent changes'),
  }),
  async handler(params, engine) {
    const timeout = DEFAULT_TIMEOUTS.composite;
    const warnings: string[] = [];
    let astUsed = false;

    // Step 0: Resolve target
    if (!params.file_path && !params.symbol) {
      return { errorSite: {}, candidates: [], stats: { candidatesConsidered: 0, callerFilesChecked: 0, astUsed: false, baseUsed: false, partialResult: false }, warnings: ['Provide at least file_path or symbol'] } satisfies RootCauseTraceResult;
    }

    const filePath = params.file_path!;
    const { uri } = await engine.prepareFile(filePath);
    await new Promise((r) => setTimeout(r, 500));
    const allDiags = engine.docManager.getCachedDiagnostics(uri);
    const errors = allDiags.filter((d) => d.severity === 1);

    // Find target diagnostic
    let targetDiag: Diagnostic | undefined;
    if (params.diagnostic_code) {
      targetDiag = errors.find((d) => `TS${d.code}` === params.diagnostic_code || String(d.code) === params.diagnostic_code);
    }
    if (!targetDiag && params.line) {
      const targetLine = params.line - 1;
      targetDiag = errors.find((d) => d.range.start.line === targetLine)
        ?? errors.find((d) => Math.abs(d.range.start.line - targetLine) <= 2);
    }
    if (!targetDiag) targetDiag = errors[0];

    if (!targetDiag) {
      return { errorSite: {}, candidates: [], stats: { candidatesConsidered: 0, callerFilesChecked: 0, astUsed: false, baseUsed: false, partialResult: false }, warnings: [`No error diagnostic in ${relativePath(filePath, engine.workspaceRoot)}`] } satisfies RootCauseTraceResult;
    }

    const base = engine.gitAvailable ? getMergeBase(engine.workspaceRoot, params.base) : undefined;
    const errorPosition = targetDiag.range.start;
    const diagPos = fromPosition(errorPosition);

    // Step 1: Resolve error site — LSP + AST
    const [hoverResult, defResult] = await Promise.all([
      engine.request<Hover | null>('textDocument/hover', { textDocument: { uri }, position: errorPosition }, timeout).catch(() => null),
      engine.request<Location | Location[] | null>('textDocument/definition', { textDocument: { uri }, position: errorPosition }, timeout).catch(() => null),
    ]);

    let localPattern: string | null = null;
    const root = parseFile(filePath);
    if (root) { astUsed = true; localPattern = classifyErrorSite(root, errorPosition.line); }

    const errorSiteSymbol = hoverResult ? formatHover(hoverResult).substring(0, 100) : undefined;
    const defLocation = defResult ? uriToPath(Array.isArray(defResult) ? defResult[0].uri : defResult.uri) : undefined;

    const errorSite = {
      symbol: errorSiteSymbol,
      definitionFile: defLocation ? relativePath(defLocation, engine.workspaceRoot) : undefined,
      enclosingNodeKind: localPattern ?? undefined,
      localPattern: localPattern ?? undefined,
    };

    // Step 2: Collect candidates
    const candidates: RootCauseCandidate[] = [];

    // Candidate A: definition site
    if (defLocation && defLocation !== filePath) {
      const changed = base ? fileChangedInBranch(defLocation, base, engine.workspaceRoot) : false;
      let score = 5;
      const evidence: string[] = [`definition-site: ${relativePath(defLocation, engine.workspaceRoot)}`];
      if (changed) {
        score += 8;
        evidence.push('changed-in-branch');
        if (base) {
          const structChange = classifyDeclarationChange(defLocation, base, engine.workspaceRoot);
          if (structChange) { score += 5; evidence.push(`structural-change: ${structChange}`); }
        }
      }
      candidates.push({
        filePath: defLocation,
        reason: changed ? 'Definition file changed in this branch' : 'Definition site — trace upstream',
        confidence: changed ? 'high' : 'medium',
        score, evidence, changedInBranch: changed,
      });
    }

    // Candidate B: type definition
    const typeDef = await engine.request<Location | Location[] | null>(
      'textDocument/typeDefinition', { textDocument: { uri }, position: errorPosition }, timeout,
    ).catch(() => null);
    if (typeDef) {
      const typeDefPath = uriToPath(Array.isArray(typeDef) ? typeDef[0].uri : typeDef.uri);
      if (typeDefPath !== filePath && typeDefPath !== defLocation) {
        const changed = base ? fileChangedInBranch(typeDefPath, base, engine.workspaceRoot) : false;
        let score = 4;
        const evidence: string[] = [`type-definition: ${relativePath(typeDefPath, engine.workspaceRoot)}`];
        if (changed) {
          score += 8; evidence.push('changed-in-branch');
          if (base) {
            const structChange = classifyDeclarationChange(typeDefPath, base, engine.workspaceRoot);
            if (structChange) { score += 5; evidence.push(`structural-change: ${structChange}`); }
          }
        }
        candidates.push({
          filePath: typeDefPath,
          reason: changed ? 'Type definition changed in this branch' : 'Type definition site',
          confidence: changed ? 'high' : 'low',
          score, evidence, changedInBranch: changed,
        });
      }
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
          const changed = base ? fileChangedInBranch(callerPath, base, engine.workspaceRoot) : false;

          await engine.prepareFile(callerPath);
          await new Promise((r) => setTimeout(r, 200));
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
          callerFilesChecked++;
        }
      }
    } catch {}

    // Step 3: Impact + fix hints
    const sorted = candidates.sort((a, b) => b.score - a.score);
    const topCandidate = sorted[0];

    if (topCandidate) {
      try {
        const { uri: topUri } = await engine.prepareFile(topCandidate.filePath);
        const refs = await engine.request<Location[] | null>(
          'textDocument/references', {
            textDocument: { uri: topUri },
            position: { line: (topCandidate.line ?? 1) - 1, character: 0 },
            context: { includeDeclaration: false },
          }, timeout,
        ).catch(() => null);
        if (refs) topCandidate.impactSummary = { affectedFiles: new Set(refs.map((r) => uriToPath(r.uri))).size };
      } catch {}

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
      nextVerificationStep: topCandidate ? `Run impact_trace on ${relativePath(topCandidate.filePath, engine.workspaceRoot)}` : undefined,
      stats: { candidatesConsidered: candidates.length, callerFilesChecked, astUsed, baseUsed: !!base, partialResult: callerFilesChecked >= 5 },
      warnings,
    } satisfies RootCauseTraceResult;
  },
});

function classifyDeclarationChange(filePath: string, base: string, workspaceRoot: string): string | null {
  try {
    const baseContent = getBaseFileContent(filePath, base, workspaceRoot);
    if (!baseContent) return null;
    const currentContent = fs.readFileSync(filePath, 'utf-8');
    const baseRoot = parseSource(baseContent, filePath.endsWith('.tsx'));
    const currentRoot = parseSource(currentContent, filePath.endsWith('.tsx'));
    const baseExports = extractExportDeclarations(baseRoot, baseContent);
    const currentExports = extractExportDeclarations(currentRoot, currentContent);
    const diffs = diffExportDeclarations(baseExports, currentExports);
    return diffs.length > 0 ? diffs.map((d) => `${d.kind}: ${d.name}`).join(', ') : null;
  } catch { return null; }
}
