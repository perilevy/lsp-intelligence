import type { QueryIR, SearchScope, WorkspaceIndex, CodeCandidate } from '../types.js';
import { scoreFieldedQuery, type FieldedDocument } from '../ranking/fieldedTextRanker.js';
import { buildSnippetFromFile } from '../../analysis/ts/snippets.js';

/**
 * Retrieve candidates from the doc/narrative index.
 * Bridges the gap between user wording and code naming by searching
 * JSDoc, comments, and test titles with fielded BM25 scoring.
 */
export function retrieveDocCandidates(
  ir: QueryIR,
  scope: SearchScope,
  index: WorkspaceIndex,
): CodeCandidate[] {
  if (ir.nlTokens.length === 0 && ir.phrases.length === 0) return [];
  if (index.docs.length === 0) return [];

  // Build fielded documents from doc entries
  const docs: FieldedDocument[] = index.docs.map((d, i) => ({
    id: String(i),
    fields: {
      docs: d.tokens,
      symbol: d.attachedSymbol
        ? d.attachedSymbol.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/\s+/)
        : [],
    },
  }));

  const queryTokens = [...ir.nlTokens, ...ir.codeTokens];
  const scored = scoreFieldedQuery(queryTokens, docs, { docs: 6, symbol: 4 }, 50);

  const candidates: CodeCandidate[] = [];
  for (const s of scored) {
    const entry = index.docs[parseInt(s.id)];
    if (!entry) continue;

    const { snippet, context } = buildSnippetFromFile(entry.filePath, entry.line, 1);
    candidates.push({
      candidateType: 'doc',
      filePath: entry.filePath,
      line: entry.line,
      symbol: entry.attachedSymbol,
      kind: 'doc',
      snippet,
      context,
      score: Math.round(s.score),
      evidence: [`doc-${entry.kind}: "${entry.text.substring(0, 60)}"`, ...s.evidence],
      sources: ['doc'],
    });
  }

  return candidates;
}
