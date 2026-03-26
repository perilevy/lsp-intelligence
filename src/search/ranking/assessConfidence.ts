import type { CodeCandidate, QueryIR, SearchPlan } from '../types.js';

/**
 * Assess overall confidence of the search results.
 * High = strong signals from multiple sources. Low = weak/generic matches.
 */
export function assessConfidence(
  ranked: CodeCandidate[],
  ir: QueryIR,
  plan: SearchPlan,
): 'high' | 'medium' | 'low' {
  if (ranked.length === 0) return 'low';

  const top = ranked[0];
  const multiSource = top.sources.length > 1;
  const hasStructural = top.sources.includes('structural');
  const highScore = top.score >= 15;
  const hasOverlap = top.evidence.some((e) => e.includes('overlap'));

  if (multiSource && highScore) return 'high';
  if (hasStructural && top.score >= 10) return 'high';
  if (hasOverlap) return 'high';
  if (highScore) return 'medium';
  if (ir.modeConfidence === 'low') return 'low';

  return 'medium';
}
