import type { QueryIR, SearchPlan, StructuralPredicate, RegExpSpec, QueryTraits } from '../types.js';

/**
 * Effective search spec — the single merged execution contract.
 * All retrievers consume this instead of raw IR.
 * Merges parser-derived signals with adapter recipe intent.
 */
export interface EffectiveSearchSpec {
  exactIdentifiers: string[];
  dottedIdentifiers: string[];
  behaviorTerms: string[];
  structuralPredicates: StructuralPredicate[];
  regexes: RegExpSpec[];
  routeTerms: string[];
  configTerms: string[];
  implementationRoot: boolean;
  traits: QueryTraits;
  /** Recipe IDs that contributed to this spec — for debug/evidence */
  recipeIds: string[];
}

/**
 * Compile an effective search spec by merging parser-derived signals with recipe intent.
 * This is the ONLY place where parser output + recipe output are unified.
 */
export function compileEffectiveSearchSpec(ir: QueryIR, plan: SearchPlan): EffectiveSearchSpec {
  const exactIdentifiers = [...ir.exactIdentifiers];
  const dottedIdentifiers = [...ir.dottedIdentifiers];
  const structuralPredicates = [...ir.structuralPredicates];
  const regexes: RegExpSpec[] = [];
  const behaviorTerms = [...ir.nlTokens, ...ir.codeTokens];
  const routeTerms: string[] = [];
  const configTerms: string[] = [];
  const recipeIds: string[] = [];

  // Extract route/config terms from NL tokens
  const ROUTE_WORDS = new Set(['route', 'endpoint', 'url', 'path', 'api', 'handler']);
  const CONFIG_WORDS = new Set(['config', 'env', 'flag', 'toggle', 'setting', 'variable', 'secret', 'feature']);

  for (const tok of ir.nlTokens) {
    if (ROUTE_WORDS.has(tok)) routeTerms.push(tok);
    if (CONFIG_WORDS.has(tok)) configTerms.push(tok);
  }

  // Propagate env-key tokens (SCREAMING_SNAKE_CASE from raw query) as config terms
  // so the config retriever can rank env-usage results by the actual key name.
  // Use ir.raw since exactIdentifiers has underscores stripped.
  for (const token of ir.raw.split(/\s+/)) {
    if (/^[A-Z][A-Z0-9_]{2,}$/.test(token) && token.includes('_')) {
      configTerms.push(token.toLowerCase().replace(/_/g, ' '));
      configTerms.push(token.toLowerCase());
    }
  }

  // Merge recipe contributions
  for (const recipe of ir.recipes) {
    recipeIds.push(recipe.id);

    if (recipe.exactIdentifiers) {
      for (const id of recipe.exactIdentifiers) {
        if (!exactIdentifiers.includes(id)) exactIdentifiers.push(id);
      }
    }

    if (recipe.structuralPredicates) {
      for (const pred of recipe.structuralPredicates) {
        if (!structuralPredicates.includes(pred)) structuralPredicates.push(pred);
      }
    }

    if (recipe.regexes) {
      for (const r of recipe.regexes) {
        if (!regexes.some((existing) => existing.id === r.id)) regexes.push(r);
      }
    }

    // Recipes from config/http adapters contribute route/config terms
    if (recipe.adapter === 'config' || recipe.adapter === 'http') {
      for (const reason of recipe.reasons) {
        if (reason.includes('route') || reason.includes('endpoint')) routeTerms.push('route');
        if (reason.includes('flag') || reason.includes('env') || reason.includes('config')) configTerms.push('config');
      }
    }
  }

  return {
    exactIdentifiers,
    dottedIdentifiers,
    behaviorTerms,
    structuralPredicates,
    regexes,
    routeTerms: [...new Set(routeTerms)],
    configTerms: [...new Set(configTerms)],
    implementationRoot: ir.traits.implementationRoot || plan.expandGraph,
    traits: ir.traits,
    recipeIds,
  };
}
