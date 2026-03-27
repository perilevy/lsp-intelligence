import type { CodeCandidate } from '../types.js';
import { candidateKey } from '../types.js';

/**
 * Merge candidates from all retrievers, deduplicating by match identity.
 * Overlapping candidates get a score boost.
 */
export function mergeCandidates(inputs: {
  behavior: CodeCandidate[];
  identifier: CodeCandidate[];
  structural: CodeCandidate[];
  doc: CodeCandidate[];
  config: CodeCandidate[];
}): CodeCandidate[] {
  const merged = new Map<string, CodeCandidate>();

  // Add behavior candidates
  for (const c of inputs.behavior) {
    merged.set(candidateKey(c), { ...c });
  }

  // Merge identifier candidates — boost on overlap
  for (const c of inputs.identifier) {
    const key = candidateKey(c);
    const existing = merged.get(key);
    if (existing) {
      existing.score += c.score + 3; // overlap bonus
      existing.evidence.push(...c.evidence, 'multi-retriever-overlap');
      for (const s of c.sources) {
        if (!existing.sources.includes(s)) existing.sources.push(s);
      }
    } else {
      merged.set(key, { ...c });
    }
  }

  // Merge structural candidates — boost on overlap
  for (const c of inputs.structural) {
    const key = candidateKey(c);
    const existing = merged.get(key);
    if (existing) {
      existing.score += c.score + 3;
      existing.evidence.push(...c.evidence, 'structural-overlap');
      for (const s of c.sources) {
        if (!existing.sources.includes(s)) existing.sources.push(s);
      }
    } else {
      merged.set(key, { ...c });
    }
  }

  // Merge doc candidates — boost on overlap with behavior/identifier
  for (const c of inputs.doc) {
    const key = candidateKey(c);
    const existing = merged.get(key);
    if (existing) {
      existing.score += Math.round(c.score * 0.5) + 2; // lighter boost for doc overlap
      existing.evidence.push(...c.evidence, 'doc-overlap');
      for (const s of c.sources) {
        if (!existing.sources.includes(s)) existing.sources.push(s);
      }
    } else {
      merged.set(key, { ...c });
    }
  }

  // Add config candidates (typically no overlap with code candidates)
  for (const c of inputs.config) {
    const key = candidateKey(c);
    if (!merged.has(key)) {
      merged.set(key, { ...c });
    }
  }

  return [...merged.values()];
}
