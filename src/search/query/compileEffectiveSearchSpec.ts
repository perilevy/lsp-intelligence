import type { QueryIR, SearchPlan, StructuralPredicate, RegExpSpec, QueryTraits } from '../types.js';

/**
 * Effective search spec — the merged execution contract from parser + recipes.
 * All retrievers should consume this instead of raw IR where relevant.
 */
export interface EffectiveSearchSpec {
  exactIdentifiers: string[];
  dottedIdentifiers: string[];
  behaviorTerms: string[];
  structuralPredicates: StructuralPredicate[];
  regexes: RegExpSpec[];
  traits: QueryTraits;
}

/**
 * Compile an effective search spec by merging parser-derived signals with recipe intent.
 * This ensures recipe-contributed predicates/identifiers are used by all retrievers.
 */
export function compileEffectiveSearchSpec(ir: QueryIR, plan: SearchPlan): EffectiveSearchSpec {
  const exactIdentifiers = [...ir.exactIdentifiers];
  const dottedIdentifiers = [...ir.dottedIdentifiers];
  const structuralPredicates = [...ir.structuralPredicates];
  const regexes: RegExpSpec[] = [];
  const behaviorTerms = [...ir.nlTokens, ...ir.codeTokens];

  for (const recipe of ir.recipes) {
    // Merge recipe identifiers
    if (recipe.exactIdentifiers) {
      for (const id of recipe.exactIdentifiers) {
        if (!exactIdentifiers.includes(id)) exactIdentifiers.push(id);
      }
    }

    // Merge recipe structural predicates
    if (recipe.structuralPredicates) {
      for (const pred of recipe.structuralPredicates) {
        if (!structuralPredicates.includes(pred)) structuralPredicates.push(pred);
      }
    }

    // Merge recipe regexes
    if (recipe.regexes) {
      for (const r of recipe.regexes) {
        if (!regexes.some((existing) => existing.id === r.id)) regexes.push(r);
      }
    }
  }

  return {
    exactIdentifiers,
    dottedIdentifiers,
    behaviorTerms,
    structuralPredicates,
    regexes,
    traits: ir.traits,
  };
}
