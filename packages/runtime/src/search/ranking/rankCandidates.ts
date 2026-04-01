import type { CodeCandidate, QueryIR, SearchPlan, SearchScope } from '../types.js';
import type { LspEngine } from '../../engine/LspEngine.js';
import type { Hover } from 'vscode-languageserver-protocol';
import { formatHover } from '../../format/markdown.js';
import { relativePath } from '../../engine/positions.js';
import { shouldSkipDir, shouldSkipFile } from '../fileKinds.js';
import * as path from 'path';

const TEST_PATTERN = /\.(spec|test|stories)\.(ts|tsx|js|jsx)$/;
const GENERATED_PATTERN = /\/(dist|es|build|generated|__generated__|\.cache)\//;
const DEMO_PATTERN = /\/(demo|example|storybook|stories|fixtures)\//;

/**
 * Check if a candidate's file path should be excluded.
 * Applied at ranking time as a safety net — catches files from stale indexes.
 */
function isExcludedPath(filePath: string): boolean {
  const parts = filePath.split(path.sep);
  for (const part of parts) {
    if (shouldSkipDir(part)) return true;
  }
  if (shouldSkipFile(filePath)) return true;
  return false;
}

/**
 * Rank candidates with mode-aware scoring + LSP enrichment.
 * First filters excluded paths, then applies penalties, enriches top candidates.
 */
export async function rankCandidates(
  candidates: CodeCandidate[],
  ctx: { ir: QueryIR; plan: SearchPlan; engine: LspEngine; scope: SearchScope },
): Promise<CodeCandidate[]> {
  // Post-filter: remove candidates from excluded paths (safety net for stale indexes)
  const clean = candidates.filter((c) => !isExcludedPath(c.filePath));

  // Apply penalties
  for (const c of clean) {
    if (TEST_PATTERN.test(c.filePath)) { c.score -= 3; c.evidence.push('penalty: test-file'); }
    if (GENERATED_PATTERN.test(c.filePath)) { c.score -= 10; c.evidence.push('penalty: generated'); }
    if (DEMO_PATTERN.test(c.filePath)) { c.score -= 4; c.evidence.push('penalty: demo'); }
    if (c.filePath.endsWith('.d.ts')) { c.score -= 6; c.evidence.push('penalty: declaration-file'); }
  }

  // Recipe-aware scoring: boost candidates from multiple backends, downweight identifier-only when recipes exist
  const hasRecipes = ctx.ir.recipes.length > 0;
  for (const c of clean) {
    // Multi-source bonus
    if (c.sources.length >= 3) {
      c.score += 3;
      c.evidence.push('multi-source-bonus');
    }
    // Recipe score boost
    for (const recipe of ctx.ir.recipes) {
      if (recipe.scoreBoost && recipe.scoreBoost > 0) {
        // Boost if candidate matches recipe's identifiers
        const recipeIds = recipe.exactIdentifiers ?? [];
        if (recipeIds.length === 0 || recipeIds.some((id) => c.matchedIdentifier === id || c.symbol === id)) {
          // Extra boost if candidate has structural evidence matching recipe
          const hasStructural = c.sources.includes('structural');
          const hasRegex = c.evidence.some((e) => e.startsWith('regex-match'));
          if (hasStructural || hasRegex) {
            c.score += recipe.scoreBoost;
            c.evidence.push(`recipe-boost: ${recipe.id}(+${recipe.scoreBoost})`);
          }
        }
      }
    }
    // Downweight identifier-only hits when recipes demand richer evidence
    if (hasRecipes && c.sources.length === 1 && c.sources[0] === 'identifier') {
      c.score -= 2;
      c.evidence.push('penalty: identifier-only-with-recipe');
    }
  }

  // Filter out negative scores
  const filtered = clean.filter((c) => c.score > 0);

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
    } catch (err: any) {
      c.evidence.push(`lsp-enrich-failed: ${err?.message ?? 'unknown'}`);
    }
  }

  // Relativize file paths
  for (const c of filtered) {
    c.filePath = relativePath(c.filePath, ctx.engine.workspaceRoot);
  }

  return filtered;
}
