import type { QueryIR, SearchPlan } from '../types.js';
import { runAdapters } from '../adapters/registry.js';

/**
 * Plan which retrievers to use based on the parsed query IR.
 *
 * Steps:
 * 1. Run adapters to generate recipes (mutates ir.recipes)
 * 2. Merge recipe retriever requirements with mode-based defaults
 * 3. Decide graph expansion from traits
 */
export function planQuery(ir: QueryIR): SearchPlan {
  // Step 1: Run adapters to populate recipes
  const recipes = runAdapters(ir);
  ir.recipes = recipes;

  const retrievers: SearchPlan['retrievers'] = [];
  const reasons: string[] = [];
  let expandGraph = false;

  // Step 2: Mode-based default retrievers
  switch (ir.mode) {
    case 'behavior':
      retrievers.push('behavior');
      reasons.push('behavior family matched — searching declarations by concept');
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

  // Step 3: Merge recipe retrievers
  for (const recipe of recipes) {
    for (const r of recipe.retrievers) {
      if (!retrievers.includes(r)) {
        retrievers.push(r);
        reasons.push(`recipe ${recipe.id} → ${r} retriever`);
      }
    }
    reasons.push(...recipe.reasons);
  }

  // Route retriever for endpoint/handler definition queries
  if (ir.traits.routeLike) {
    if (!retrievers.includes('route')) {
      retrievers.push('route');
      reasons.push('route trait detected — searching route definitions in code');
    }
    if (!retrievers.includes('config')) {
      retrievers.push('config');
      reasons.push('route trait detected — also searching config route maps');
    }
  }

  // Config retriever for config/flag/env queries
  if (ir.traits.configLike && !retrievers.includes('config')) {
    retrievers.push('config');
    reasons.push('config trait detected — searching config files');
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
