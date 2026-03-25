import type { BehaviorCandidate } from './types.js';

const TEST_PATTERN = /\.(spec|test|stories)\.(ts|tsx|js|jsx)$/;
const GENERATED_PATTERN = /\/(dist|es|build|generated|__generated__|\.cache)\//;
const DECLARATION_PATTERN = /\.d\.ts$/;
const DEMO_PATTERN = /\/(demo|example|storybook|stories|fixtures)\//;

/**
 * Merge candidates from lexical and AST sources, deduplicating by file+symbol.
 */
export function mergeCandidates(
  lexical: BehaviorCandidate[],
  ast: BehaviorCandidate[],
): BehaviorCandidate[] {
  const merged = new Map<string, BehaviorCandidate>();

  // Add lexical candidates
  for (const c of lexical) {
    const key = `${c.filePath}:${c.symbol ?? c.line}`;
    merged.set(key, { ...c });
  }

  // Merge AST candidates — boost if overlap, add if new
  for (const c of ast) {
    const key = `${c.filePath}:${c.symbol ?? c.line}`;
    const existing = merged.get(key);
    if (existing) {
      // Overlap: lexical + AST → bonus
      existing.score += c.score + 4; // overlap bonus
      existing.evidence.push(...c.evidence);
      existing.evidence.push('lexical+ast-overlap');
      if (!existing.sources.includes('ast')) existing.sources.push('ast');
    } else {
      merged.set(key, { ...c });
    }
  }

  return [...merged.values()];
}

/**
 * Apply penalties and final ranking adjustments.
 */
export function applyPenalties(candidates: BehaviorCandidate[]): BehaviorCandidate[] {
  for (const c of candidates) {
    // Penalties
    if (TEST_PATTERN.test(c.filePath)) {
      c.score -= 3;
      c.evidence.push('penalty: test-file');
    }
    if (DEMO_PATTERN.test(c.filePath)) {
      c.score -= 4;
      c.evidence.push('penalty: demo/example');
    }
    if (GENERATED_PATTERN.test(c.filePath)) {
      c.score -= 10;
      c.evidence.push('penalty: generated');
    }
    if (DECLARATION_PATTERN.test(c.filePath)) {
      c.score -= 6;
      c.evidence.push('penalty: declaration-only');
    }
  }

  return candidates
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
}

/**
 * Determine confidence level based on top candidates.
 */
export function assessConfidence(
  candidates: BehaviorCandidate[],
): 'high' | 'medium' | 'low' {
  if (candidates.length === 0) return 'low';

  const top = candidates[0];
  const hasAstMatch = top.sources.includes('ast');
  const hasOverlap = top.evidence.includes('lexical+ast-overlap');
  const highScore = top.score >= 15;

  if (hasOverlap && highScore) return 'high';
  if (hasAstMatch || highScore) return 'medium';
  return 'low';
}
