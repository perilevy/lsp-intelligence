import type { QueryIR, SearchPlan } from '../types.js';

/**
 * Plan which retrievers to use based on the parsed query IR.
 *
 * Key design rule: the planner can choose ['identifier', 'structural']
 * WITHOUT behavior retrieval. This is the core fix for queries like
 * "useEffect that returns a cleanup callback conditionally".
 */
export function planQuery(ir: QueryIR): SearchPlan {
  const retrievers: SearchPlan['retrievers'] = [];
  const reasons: string[] = [];

  switch (ir.mode) {
    case 'behavior':
      retrievers.push('behavior');
      reasons.push('behavior family matched — searching declarations by concept');
      break;

    case 'identifier':
      retrievers.push('identifier');
      reasons.push('exact identifier detected — searching usage sites');
      // Also add structural if any predicates exist
      if (ir.structuralPredicates.length > 0) {
        retrievers.push('structural');
        reasons.push('structural predicates found — will filter by code shape');
      }
      break;

    case 'structural':
      // Identifier + structural: locate by identifier, filter by structure
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

  // Ensure at least one retriever
  if (retrievers.length === 0) {
    retrievers.push('behavior');
    reasons.push('fallback: no specific signals, using behavior search');
  }

  return {
    mode: ir.mode,
    retrievers,
    reasons,
  };
}
