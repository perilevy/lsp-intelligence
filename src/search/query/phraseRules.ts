import type { StructuralPredicate, QueryTraits } from '../types.js';

interface PhraseRule {
  /** Phrases or token combinations that trigger this rule */
  match: (tokens: string[], phrases: string[], traits: QueryTraits) => boolean;
  /** Predicates to add */
  predicates: StructuralPredicate[];
  /** Reason for debug trace */
  reason: string;
}

const PHRASE_RULES: PhraseRule[] = [
  {
    match: (tok, phrases) =>
      phrases.some((p) => p.includes('returns cleanup') || p.includes('return cleanup')),
    predicates: ['returns-cleanup'],
    reason: 'phrase: "returns cleanup"',
  },
  {
    match: (tok, phrases) =>
      phrases.some((p) => p.includes('without cleanup')),
    predicates: ['no-cleanup'],
    reason: 'phrase: "without cleanup"',
  },
  {
    match: (tok, phrases) =>
      phrases.some((p) => p.includes('without try') || p.includes('without catch') || p.includes('no try')),
    predicates: ['no-try-catch'],
    reason: 'phrase: "without try/catch"',
  },
  {
    match: (tok, phrases) =>
      phrases.some((p) => p.includes('switch without') || p.includes('without default')),
    predicates: ['switch-no-default'],
    reason: 'phrase: "switch without default"',
  },
  {
    match: (tok, phrases) =>
      phrases.some((p) => p.includes('await inside') || p.includes('await loop') || p.includes('loop await')),
    predicates: ['await-in-loop'],
    reason: 'phrase: "await inside loop"',
  },
  {
    match: (_tok, _phrases, traits) =>
      traits.previousStateLike,
    predicates: ['functional-state-updater'],
    reason: 'trait: previousStateLike → functional state updater pattern',
  },
  {
    match: (tok, phrases) =>
      phrases.some((p) => p.includes('conditional cleanup') || p.includes('conditionally return')),
    predicates: ['conditional', 'returns-cleanup'],
    reason: 'phrase: "conditional cleanup"',
  },
];

/**
 * Apply phrase-based rules to infer structural predicates.
 * Called after token-level parsing to add predicates that require
 * multi-word combinations, not isolated keywords.
 */
export function applyPhraseRules(
  existingPredicates: StructuralPredicate[],
  tokens: string[],
  phrases: string[],
  traits: QueryTraits,
): { added: StructuralPredicate[]; reasons: string[] } {
  const added: StructuralPredicate[] = [];
  const reasons: string[] = [];

  for (const rule of PHRASE_RULES) {
    if (rule.match(tokens, phrases, traits)) {
      for (const pred of rule.predicates) {
        if (!existingPredicates.includes(pred) && !added.includes(pred)) {
          added.push(pred);
        }
      }
      reasons.push(rule.reason);
    }
  }

  return { added, reasons };
}
