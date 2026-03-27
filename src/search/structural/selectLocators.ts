import type { QueryIR } from '../types.js';
import type { StructuralLocator } from './locators/types.js';
import { callLocator } from './locators/callLocator.js';
import { statementLocator } from './locators/statementLocator.js';
import { declarationLocator } from './locators/declarationLocator.js';

const ALL_LOCATORS: StructuralLocator[] = [
  callLocator,
  statementLocator,
  declarationLocator,
];

/**
 * Select which locators to use based on the query's structural predicates.
 * May return multiple locators if the query spans call + statement shapes.
 */
export function selectLocators(ir: QueryIR): StructuralLocator[] {
  const selected = ALL_LOCATORS.filter((l) => l.supports(ir.structuralPredicates, ir));
  // Always include at least call locator if we have identifiers
  if (selected.length === 0 && (ir.exactIdentifiers.length > 0 || ir.dottedIdentifiers.length > 0)) {
    selected.push(callLocator);
  }
  return selected;
}
