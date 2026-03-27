/**
 * Fielded text scorer — lightweight BM25-inspired local ranker.
 * Scores documents with multiple named fields against query tokens.
 */

export interface FieldedDocument {
  id: string;
  fields: Record<string, string[]>;
}

export interface FieldedScore {
  id: string;
  score: number;
  evidence: string[];
}

export interface FieldWeights {
  symbol: number;
  path: number;
  docs: number;
  tests: number;
  config?: number;
}

const DEFAULT_WEIGHTS: FieldWeights = {
  symbol: 8,
  path: 3,
  docs: 5,
  tests: 4,
  config: 3,
};

/**
 * Score query tokens against fielded documents.
 * Uses a simplified BM25-like scoring: term frequency within fields,
 * weighted by field importance, with length normalization.
 */
export function scoreFieldedQuery(
  queryTokens: string[],
  docs: FieldedDocument[],
  weights?: Partial<FieldWeights>,
  limit: number = 100,
): FieldedScore[] {
  const w: FieldWeights = { ...DEFAULT_WEIGHTS, ...weights };
  const results: FieldedScore[] = [];

  // Compute average field lengths for normalization
  const avgLengths: Record<string, number> = {};
  const fieldNames = new Set<string>();
  for (const doc of docs) {
    for (const [field, tokens] of Object.entries(doc.fields)) {
      fieldNames.add(field);
      avgLengths[field] = (avgLengths[field] ?? 0) + tokens.length;
    }
  }
  for (const field of fieldNames) {
    avgLengths[field] = docs.length > 0 ? avgLengths[field] / docs.length : 1;
  }

  // IDF: tokens that appear in fewer docs are more valuable
  const docFreq: Record<string, number> = {};
  for (const tok of queryTokens) {
    docFreq[tok] = 0;
    for (const doc of docs) {
      const allTokens = Object.values(doc.fields).flat();
      if (allTokens.some((t) => t === tok || t.startsWith(tok) || tok.startsWith(t))) {
        docFreq[tok]++;
      }
    }
  }

  const N = docs.length || 1;

  for (const doc of docs) {
    let totalScore = 0;
    const evidence: string[] = [];

    for (const tok of queryTokens) {
      const idf = Math.log((N - docFreq[tok] + 0.5) / (docFreq[tok] + 0.5) + 1);

      for (const [field, tokens] of Object.entries(doc.fields)) {
        const fieldWeight = (w as any)[field] ?? 1;
        const avgLen = avgLengths[field] || 1;
        const k1 = 1.2;
        const b = 0.75;

        // Count matches (exact + prefix)
        let tf = 0;
        for (const t of tokens) {
          if (t === tok) tf += 1;
          else if (t.startsWith(tok) || tok.startsWith(t)) tf += 0.5;
        }

        if (tf === 0) continue;

        // BM25 TF component with length normalization
        const lenNorm = 1 - b + b * (tokens.length / avgLen);
        const tfScore = (tf * (k1 + 1)) / (tf + k1 * lenNorm);
        const fieldScore = idf * tfScore * fieldWeight;

        totalScore += fieldScore;
        evidence.push(`${field}:${tok}(${fieldScore.toFixed(1)})`);
      }
    }

    if (totalScore > 0) {
      results.push({ id: doc.id, score: totalScore, evidence });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
