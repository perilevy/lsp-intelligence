import type { SearchAdapter } from './types.js';
import type { QueryIR, SearchRecipe } from '../types.js';
import { reactAdapter } from './react.js';

const ADAPTERS: SearchAdapter[] = [
  reactAdapter,
  // Future: httpAdapter, configAdapter, validationAdapter
];

/**
 * Run all registered adapters against a parsed query IR.
 * Returns all emitted recipes.
 */
export function runAdapters(ir: QueryIR): SearchRecipe[] {
  const recipes: SearchRecipe[] = [];
  for (const adapter of ADAPTERS) {
    recipes.push(...adapter.detect(ir));
  }
  return recipes;
}
