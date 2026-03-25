import { BEHAVIOR_FAMILIES } from './behaviorFamilies.js';
import { tokenize } from './lexicalIndex.js';
import type { NormalizedQuery, LexicalEntry, BehaviorCandidate } from './types.js';

/**
 * Normalize a natural-language behavior query into searchable tokens.
 */
export function normalizeQuery(raw: string): NormalizedQuery {
  const tokens = tokenize(raw);

  // Match tokens against behavior family triggers
  const matchedFamilies: string[] = [];
  const synonyms: string[] = [];

  for (const family of BEHAVIOR_FAMILIES) {
    const allTriggers = [...family.triggerTerms, ...family.synonyms];
    const hasMatch = tokens.some((t) =>
      allTriggers.some((trigger) => trigger.includes(t) || t.includes(trigger)),
    );
    if (hasMatch) {
      matchedFamilies.push(family.id);
      synonyms.push(...family.synonyms.filter((s) => !tokens.includes(s)));
    }
  }

  // Deduplicate synonyms
  const uniqueSynonyms = [...new Set(synonyms)].slice(0, 15);

  return {
    raw,
    tokens,
    behaviorFamilies: matchedFamilies,
    synonyms: uniqueSynonyms,
  };
}

/**
 * Score lexical entries against a normalized query.
 * Returns candidates sorted by score, deduplicated.
 */
export function lexicalRecall(
  index: LexicalEntry[],
  query: NormalizedQuery,
  maxResults: number,
): BehaviorCandidate[] {
  const allSearchTerms = [...query.tokens, ...query.synonyms];
  const matchedFamilies = BEHAVIOR_FAMILIES.filter((f) => query.behaviorFamilies.includes(f.id));

  const scored: BehaviorCandidate[] = [];
  const seen = new Set<string>();

  for (const entry of index) {
    const key = `${entry.filePath}:${entry.symbol}`;
    if (seen.has(key)) continue;

    let score = 0;
    const evidence: string[] = [];

    // Token matching against symbol name
    for (const term of allSearchTerms) {
      for (const token of entry.tokens) {
        if (token === term) {
          score += 8;
          evidence.push(`symbol-name-match: ${term}`);
        } else if (token.includes(term) || term.includes(token)) {
          score += 4;
          evidence.push(`symbol-partial-match: ${term}~${token}`);
        }
      }
    }

    // File path matching
    const pathLower = entry.filePath.toLowerCase();
    for (const family of matchedFamilies) {
      for (const hint of family.fileHints) {
        if (pathLower.includes(hint)) {
          score += family.scoreBoosts.pathHint;
          evidence.push(`file-path-match: ${hint}`);
          break;
        }
      }
    }

    // Export bonus
    if (entry.isExported) {
      score += 2;
      evidence.push('exported-symbol');
    }

    if (score > 0) {
      seen.add(key);
      scored.push({
        symbol: entry.symbol,
        kind: entry.kind as BehaviorCandidate['kind'],
        filePath: entry.filePath,
        line: entry.line,
        score,
        evidence,
        sources: ['lexical'],
      });
    }
  }

  // Sort by score descending, take top N
  return scored.sort((a, b) => b.score - a.score).slice(0, maxResults);
}
