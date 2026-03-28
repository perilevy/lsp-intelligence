import type { CodeCandidate } from '../types.js';

/**
 * Coalesce candidates that represent the same logical match.
 * Merges doc + declaration, usage + pattern, etc. at the same location/symbol.
 *
 * This runs after retriever merge and before ranking, preventing
 * duplicate entries for the same symbol from different retriever types.
 */
export function coalesceCandidates(candidates: CodeCandidate[]): CodeCandidate[] {
  const coalesced = new Map<string, CodeCandidate>();

  for (const c of candidates) {
    const key = coalesceKey(c);
    const existing = coalesced.get(key);

    if (existing) {
      // Merge: keep the higher score, combine evidence and sources
      existing.score = Math.max(existing.score, c.score) + 2; // coalesce bonus
      existing.evidence.push(...c.evidence, `coalesced: ${c.candidateType}`);
      for (const s of c.sources) {
        if (!existing.sources.includes(s)) existing.sources.push(s);
      }
      // Prefer longer snippet/context
      if (c.snippet && (!existing.snippet || c.snippet.length > existing.snippet.length)) {
        existing.snippet = c.snippet;
        existing.context = c.context;
      }
      // Prefer declaration type over doc type
      if (c.candidateType === 'declaration' && existing.candidateType === 'doc') {
        existing.candidateType = 'declaration';
        existing.kind = c.kind;
      }
    } else {
      coalesced.set(key, { ...c });
    }
  }

  return [...coalesced.values()];
}

/**
 * Coalesce key: same file + same line (within 2 lines) + same symbol.
 * Does NOT include candidateType — that's the whole point.
 */
function coalesceKey(c: CodeCandidate): string {
  // Round line to nearest 2 to catch doc comments 1-2 lines above the declaration
  const roundedLine = Math.floor(c.line / 3) * 3;
  const symbol = c.symbol ?? c.matchedIdentifier ?? '';
  return `${c.filePath}:${roundedLine}:${symbol}`;
}
