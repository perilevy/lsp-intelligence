import type { CodeCandidate, QueryIR, SearchPlan, SearchScope } from '../types.js';
import type { LspEngine } from '../../engine/LspEngine.js';
import type { Hover } from 'vscode-languageserver-protocol';
import { formatHover } from '../../format/markdown.js';
import { relativePath } from '../../engine/positions.js';

const TEST_PATTERN = /\.(spec|test|stories)\.(ts|tsx|js|jsx)$/;
const GENERATED_PATTERN = /\/(dist|es|build|generated|__generated__|\.cache)\//;
const DEMO_PATTERN = /\/(demo|example|storybook|stories|fixtures)\//;

/**
 * Rank candidates with mode-aware scoring + LSP enrichment.
 * Applies penalties, enriches top candidates with hover signatures.
 */
export async function rankCandidates(
  candidates: CodeCandidate[],
  ctx: { ir: QueryIR; plan: SearchPlan; engine: LspEngine; scope: SearchScope },
): Promise<CodeCandidate[]> {
  // Apply penalties
  for (const c of candidates) {
    if (TEST_PATTERN.test(c.filePath)) { c.score -= 3; c.evidence.push('penalty: test-file'); }
    if (GENERATED_PATTERN.test(c.filePath)) { c.score -= 10; c.evidence.push('penalty: generated'); }
    if (DEMO_PATTERN.test(c.filePath)) { c.score -= 4; c.evidence.push('penalty: demo'); }
    if (c.filePath.endsWith('.d.ts')) { c.score -= 6; c.evidence.push('penalty: declaration-file'); }
  }

  // Filter out negative scores
  const filtered = candidates.filter((c) => c.score > 0);

  // Sort by score
  filtered.sort((a, b) => b.score - a.score);

  // LSP enrichment for top candidates (use actual match position, not line 0)
  const enrichLimit = Math.min(15, filtered.length);
  for (let i = 0; i < enrichLimit; i++) {
    const c = filtered[i];
    try {
      const { uri } = await ctx.engine.prepareFile(c.filePath);
      const position = { line: c.line - 1, character: c.column ?? 0 };
      const hover = await ctx.engine.request<Hover | null>(
        'textDocument/hover', { textDocument: { uri }, position }, 5000,
      );
      if (hover) {
        c.signature = formatHover(hover).substring(0, 200);
        if (!c.sources.includes('lsp')) c.sources.push('lsp');
      }
    } catch {}
  }

  // Relativize file paths
  for (const c of filtered) {
    c.filePath = relativePath(c.filePath, ctx.engine.workspaceRoot);
  }

  return filtered;
}
