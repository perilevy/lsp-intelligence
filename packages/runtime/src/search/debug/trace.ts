import type { QueryIR, SearchPlan, CodeCandidate, FindCodeDebugInfo } from '../types.js';

/**
 * Build debug trace info for find_code results.
 * Only called when debug=true — no overhead on normal queries.
 */
export function buildDebugTrace(
  ir: QueryIR,
  plan: SearchPlan,
  candidates: CodeCandidate[],
  retrieverCounts: Record<string, number>,
): FindCodeDebugInfo {
  return {
    recipes: [
      `mode: ${ir.mode} (confidence: ${ir.modeConfidence})`,
      ...ir.routingReasons.map((r) => `routing: ${r}`),
      ...plan.reasons.map((r) => `plan: ${r}`),
      ...(ir.traits.routeLike ? ['trait: routeLike'] : []),
      ...(ir.traits.configLike ? ['trait: configLike'] : []),
      ...(ir.traits.implementationRoot ? ['trait: implementationRoot'] : []),
      ...(ir.traits.testIntent ? ['trait: testIntent'] : []),
      ...(plan.expandGraph ? ['graphExpansion: enabled'] : []),
    ],
    retrieverStats: retrieverCounts,
    scoreBreakdown: candidates.slice(0, 15).map((c) => ({
      candidateKey: `${c.filePath}:${c.line}:${c.symbol ?? c.matchedIdentifier ?? ''}`,
      score: c.score,
      evidence: c.evidence,
    })),
  };
}
