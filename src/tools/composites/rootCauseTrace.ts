import { z } from 'zod';
import { execSync } from 'child_process';
import * as fs from 'fs';
import { defineTool } from '../registry.js';
import { relativePath, uriToPath, pathToUri, fromPosition } from '../../engine/positions.js';
import { formatHover } from '../../format/markdown.js';
import { parseFile } from '../../ast/parseFile.js';
import { classifyErrorSite } from '../../ast/findNodeAtPosition.js';
import type { Location, Hover, Diagnostic, DocumentSymbol, CallHierarchyItem, CallHierarchyIncomingCall } from 'vscode-languageserver-protocol';
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
  impactSummary?: { affectedFiles: number };
}

export const rootCauseTrace = defineTool({
  name: 'root_cause_trace',
  description: 'Trace the root cause of a TypeScript error. Given a diagnostic location, identifies the most likely originating declaration change with an evidence chain. Use when fixing the symptom isn\'t enough — find what actually broke.',
  schema: z.object({
    file_path: z.string().describe('File with the error'),
    line: z.number().optional().describe('Error line (1-indexed). If omitted, uses first diagnostic.'),
    base: z.string().optional().describe('Git base ref to check recent changes'),
  }),
  async handler(params, engine) {
    const timeout = DEFAULT_TIMEOUTS.composite;
    let astUsed = false;

    // Step 0: Resolve the target diagnostic
    const { uri } = await engine.prepareFile(params.file_path);
    await new Promise((r) => setTimeout(r, 500)); // Wait for diagnostics
    const allDiags = engine.docManager.getCachedDiagnostics(uri);
    const errors = allDiags.filter((d) => d.severity === 1);

    let targetDiag: Diagnostic | undefined;
    if (params.line) {
      const targetLine = params.line - 1;
      targetDiag = errors.find((d) => d.range.start.line === targetLine)
        ?? errors.find((d) => Math.abs(d.range.start.line - targetLine) <= 2);
    } else {
      targetDiag = errors[0];
    }

    if (!targetDiag) {
      const rel = relativePath(params.file_path, engine.workspaceRoot);
      return `No error diagnostic found in ${rel}${params.line ? ` near line ${params.line}` : ''}. File may be clean.`;
    }

    const diagPos = fromPosition(targetDiag.range.start);
    const diagCode = targetDiag.code ? `TS${targetDiag.code}` : '';
    const rel = relativePath(params.file_path, engine.workspaceRoot);

    // Step 1: Resolve error site with LSP + AST
    const errorPosition = targetDiag.range.start;

    // LSP: hover + definition
    const [hoverResult, defResult] = await Promise.all([
      engine.request<Hover | null>('textDocument/hover', { textDocument: { uri }, position: errorPosition }, timeout).catch(() => null),
      engine.request<Location | Location[] | null>('textDocument/definition', { textDocument: { uri }, position: errorPosition }, timeout).catch(() => null),
    ]);

    // AST: classify error site
    let localPattern: string | null = null;
    const root = parseFile(params.file_path);
    if (root) {
      astUsed = true;
      localPattern = classifyErrorSite(root, errorPosition.line);
    }

    const errorSiteSymbol = hoverResult ? formatHover(hoverResult).substring(0, 100) : undefined;
    const defLocation = defResult
      ? uriToPath(Array.isArray(defResult) ? defResult[0].uri : defResult.uri)
      : undefined;

    // Step 2: Collect candidate origins
    const candidates: RootCauseCandidate[] = [];

    // Candidate A: definition/type-definition
    if (defLocation && defLocation !== params.file_path) {
      const defRel = relativePath(defLocation, engine.workspaceRoot);
      const changedInBranch = await fileChangedInBranch(defLocation, params.base, engine);
      let score = 5;
      const evidence: string[] = [`definition-site: ${defRel}`];

      if (changedInBranch) {
        score += 8;
        evidence.push('changed-in-branch');

        // AST: classify what changed
        if (params.base && engine.gitAvailable) {
          const structChange = await classifyDeclarationChange(defLocation, params.base, engine);
          if (structChange) {
            score += 5;
            evidence.push(`structural-change: ${structChange}`);
          }
        }
      }

      candidates.push({
        symbol: defRel.split('/').pop()?.replace(/\.tsx?$/, ''),
        filePath: defLocation,
        reason: changedInBranch
          ? `Definition file changed in this branch`
          : `Definition site — trace upstream for root cause`,
        confidence: changedInBranch ? 'high' : 'medium',
        score,
        evidence,
        changedInBranch,
      });
    }

    // Candidate B: type definition (for type mismatches)
    const typeDef = await engine.request<Location | Location[] | null>(
      'textDocument/typeDefinition', { textDocument: { uri }, position: errorPosition }, timeout,
    ).catch(() => null);

    if (typeDef) {
      const typeDefPath = uriToPath(Array.isArray(typeDef) ? typeDef[0].uri : typeDef.uri);
      if (typeDefPath !== params.file_path && typeDefPath !== defLocation) {
        const changedInBranch = await fileChangedInBranch(typeDefPath, params.base, engine);
        const typeRel = relativePath(typeDefPath, engine.workspaceRoot);
        let score = 4;
        const evidence: string[] = [`type-definition: ${typeRel}`];

        if (changedInBranch) {
          score += 8;
          evidence.push('changed-in-branch');

          const structChange = params.base ? await classifyDeclarationChange(typeDefPath, params.base, engine) : null;
          if (structChange) {
            score += 5;
            evidence.push(`structural-change: ${structChange}`);
          }
        }

        candidates.push({
          filePath: typeDefPath,
          reason: changedInBranch
            ? `Type definition changed in this branch`
            : `Type definition site`,
          confidence: changedInBranch ? 'high' : 'low',
          score,
          evidence,
          changedInBranch,
        });
      }
    }

    // Candidate C: upstream callers (check for propagated errors)
    try {
      const items = await engine.request<CallHierarchyItem[] | null>(
        'textDocument/prepareCallHierarchy', { textDocument: { uri }, position: errorPosition }, timeout,
      );
      if (items && items.length > 0) {
        const incomingCalls = await engine.request<CallHierarchyIncomingCall[] | null>(
          'callHierarchy/incomingCalls', { item: items[0] }, timeout,
        );
        if (incomingCalls) {
          for (const call of incomingCalls.slice(0, 5)) {
            const callerPath = uriToPath(call.from.uri);
            if (callerPath === params.file_path) continue;
            const changedInBranch = await fileChangedInBranch(callerPath, params.base, engine);
            const callerRel = relativePath(callerPath, engine.workspaceRoot);

            // Check if caller has diagnostics too
            await engine.prepareFile(callerPath);
            await new Promise((r) => setTimeout(r, 200));
            const callerDiags = engine.docManager.getCachedDiagnostics(pathToUri(callerPath));
            const callerErrors = callerDiags.filter((d) => d.severity === 1).length;

            let score = 2;
            const evidence: string[] = [`upstream-caller: ${callerRel}`];
            if (changedInBranch) { score += 6; evidence.push('changed-in-branch'); }
            if (callerErrors > 0) { score += 3; evidence.push(`caller-has-errors: ${callerErrors}`); }

            candidates.push({
              symbol: call.from.name,
              filePath: callerPath,
              reason: changedInBranch
                ? `Upstream caller changed in this branch${callerErrors ? ` (${callerErrors} errors)` : ''}`
                : `Upstream caller${callerErrors ? ` with ${callerErrors} errors` : ''}`,
              confidence: changedInBranch && callerErrors > 0 ? 'high' : 'low',
              score,
              evidence,
              changedInBranch,
            });
          }
        }
      }
    } catch {}

    // Step 3: Impact check on top candidate
    const sorted = candidates.sort((a, b) => b.score - a.score);
    const topCandidate = sorted[0];

    if (topCandidate) {
      // Get reference count for impact
      try {
        const { uri: topUri } = await engine.prepareFile(topCandidate.filePath);
        const refs = await engine.request<Location[] | null>(
          'textDocument/references', {
            textDocument: { uri: topUri },
            position: { line: (topCandidate.line ?? 1) - 1, character: 0 },
            context: { includeDeclaration: false },
          }, timeout,
        ).catch(() => null);
        if (refs) {
          topCandidate.impactSummary = {
            affectedFiles: new Set(refs.map((r) => uriToPath(r.uri))).size,
          };
        }
      } catch {}
    }

    // Step 4: AST-enhanced fix hints
    let suggestedFix: string | undefined;
    if (localPattern) {
      if (localPattern === 'unhandled_enum_member' && topCandidate?.evidence.some((e) => e.includes('enum'))) {
        suggestedFix = 'Add a case for the new enum member in the switch statement';
      } else if (localPattern === 'bad_call_argument') {
        suggestedFix = 'Check the function signature — a parameter type may have changed';
      } else if (localPattern === 'missing_property_access') {
        suggestedFix = 'A property may have been removed or renamed in the source type';
      } else if (localPattern === 'incompatible_assignment') {
        suggestedFix = 'The source type may have changed — check the definition';
      }
    }

    // Step 5: Format output
    const lines: string[] = [`# Root Cause Analysis\n`];
    lines.push(`## Error`);
    lines.push(`${diagCode} at ${rel}:${diagPos.line} — ${targetDiag.message}\n`);

    if (localPattern) {
      lines.push(`**Error pattern:** ${localPattern}`);
    }
    if (errorSiteSymbol) {
      lines.push(`**Type at error:** ${errorSiteSymbol.substring(0, 100)}`);
    }
    lines.push('');

    if (topCandidate) {
      const topRel = relativePath(topCandidate.filePath, engine.workspaceRoot);
      lines.push(`## Root Cause (${topCandidate.confidence} confidence)\n`);
      lines.push(`${topCandidate.reason}`);
      lines.push(`File: ${topRel}${topCandidate.line ? `:${topCandidate.line}` : ''}`);

      if (topCandidate.evidence.length > 0) {
        lines.push(`\n**Evidence:** ${topCandidate.evidence.join(' → ')}`);
      }
      if (topCandidate.impactSummary) {
        lines.push(`**Impact:** ${topCandidate.impactSummary.affectedFiles} files reference this symbol`);
      }
      if (suggestedFix) {
        lines.push(`\n**Suggested fix:** ${suggestedFix}`);
      }
    } else {
      lines.push(`## No clear root cause found\n`);
      lines.push(`The error may be a local issue. Check the type at the error site.`);
    }

    if (sorted.length > 1) {
      lines.push(`\n## Other candidates\n`);
      for (const c of sorted.slice(1, 4)) {
        const cRel = relativePath(c.filePath, engine.workspaceRoot);
        lines.push(`- **${c.reason}** — ${cRel} (score: ${c.score}, ${c.confidence})`);
      }
    }

    lines.push(`\n**Stats:** ${candidates.length} candidates, ${sorted.filter((c) => c.changedInBranch).length} changed in branch, AST: ${astUsed}`);

    return lines.join('\n');
  },
});

async function fileChangedInBranch(filePath: string, base: string | undefined, engine: any): Promise<boolean> {
  if (!base || !engine.gitAvailable) return false;
  try {
    const relPath = relativePath(filePath, engine.workspaceRoot);
    const diff = execSync(`git diff ${base} --name-only -- "${relPath}"`, {
      cwd: engine.workspaceRoot, encoding: 'utf-8',
    });
    return diff.trim().length > 0;
  } catch {
    return false;
  }
}

async function classifyDeclarationChange(filePath: string, base: string, engine: any): Promise<string | null> {
  try {
    const relPath = relativePath(filePath, engine.workspaceRoot) ?? '';
    if (!relPath) return null;
    const baseContent = execSync(`git show ${base}:${relPath}`, { cwd: engine.workspaceRoot, encoding: 'utf-8' });
    const currentContent = fs.readFileSync(filePath, 'utf-8');

    const { extractExportDeclarations } = await import('../../ast/extractExportDeclarations.js');
    const { parseSource } = await import('../../ast/parseFile.js');

    const baseRoot = parseSource(baseContent, filePath.endsWith('.tsx'));
    const currentRoot = parseSource(currentContent, filePath.endsWith('.tsx'));

    const baseExports = baseRoot ? extractExportDeclarations(baseRoot, baseContent) : [];
    const currentExports = currentRoot ? extractExportDeclarations(currentRoot, currentContent) : [];

    const { diffExportDeclarations } = await import('../../ast/diffDeclarationShapes.js');
    const diffs = diffExportDeclarations(baseExports, currentExports);

    if (diffs.length > 0) {
      return diffs.map((d) => `${d.kind}: ${d.name}`).join(', ');
    }
  } catch {}
  return null;
}
