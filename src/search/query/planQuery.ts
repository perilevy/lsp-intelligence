import type { QueryIR, SearchPlan } from '../types.js';

/**
 * Plan which retrievers to use based on the parsed query IR.
 *
 * Key design rules:
 * - identifier + structural WITHOUT behavior is valid (useEffect cleanup queries)
 * - doc retriever adds narrative bridge for behavior queries
 * - config retriever activates for route/config/flag traits
 * - graph expansion activates for implementation-root queries
 */
export function planQuery(ir: QueryIR): SearchPlan {
  const retrievers: SearchPlan['retrievers'] = [];
  const reasons: string[] = [];
  let expandGraph = false;

  switch (ir.mode) {
    case 'behavior':
      retrievers.push('behavior');
      reasons.push('behavior family matched — searching declarations by concept');
      // Always add doc retriever for behavior queries (narrative bridge)
      retrievers.push('doc');
      reasons.push('doc retriever for narrative/comment bridge');
      break;

    case 'identifier':
      retrievers.push('identifier');
      reasons.push('exact identifier detected — searching usage sites');
      if (ir.structuralPredicates.length > 0) {
        retrievers.push('structural');
        reasons.push('structural predicates found — will filter by code shape');
      }
      break;

    case 'structural':
      if (ir.exactIdentifiers.length > 0 || ir.dottedIdentifiers.length > 0) {
        retrievers.push('identifier');
        reasons.push('using identifier to locate candidate sites');
      }
      retrievers.push('structural');
      reasons.push('structural predicates will filter/rank results');
      break;

    case 'mixed':
      retrievers.push('behavior');
      reasons.push('behavior retrieval for concept matching');
      retrievers.push('doc');
      reasons.push('doc retriever for narrative bridge');
      if (ir.exactIdentifiers.length > 0 || ir.dottedIdentifiers.length > 0) {
        retrievers.push('identifier');
        reasons.push('identifier retrieval for exact API matches');
      }
      if (ir.structuralPredicates.length > 0) {
        retrievers.push('structural');
        reasons.push('structural predicates for shape filtering');
      }
      break;
  }

  // Config retriever for route/config/flag/env queries
  if (ir.traits.routeLike || ir.traits.configLike) {
    retrievers.push('config');
    reasons.push('config/route trait detected — searching config files');
  }

  // Graph expansion for implementation-root queries
  if (ir.traits.implementationRoot) {
    expandGraph = true;
    reasons.push('implementation-root trait — will expand to real implementations');
  }

  // Ensure at least one retriever
  if (retrievers.length === 0) {
    retrievers.push('behavior');
    retrievers.push('doc');
    reasons.push('fallback: no specific signals, using behavior + doc search');
  }

  return {
    mode: ir.mode,
    retrievers,
    reasons,
    expandGraph,
  };
}
