import type { QueryIR, SearchScope, WorkspaceIndex, CodeCandidate } from '../types.js';
import { scoreFieldedQuery, type FieldedDocument } from '../ranking/fieldedTextRanker.js';
import { buildSnippetFromFile } from '../../analysis/ts/snippets.js';

/**
 * Retrieve candidates from the config/registry index.
 * Handles route/endpoint, env var, feature flag, and general config queries.
 */
export function retrieveConfigCandidates(
  ir: QueryIR,
  scope: SearchScope,
  index: WorkspaceIndex,
): CodeCandidate[] {
  if (index.configs.length === 0) return [];

  const queryTokens = [...ir.nlTokens, ...ir.codeTokens, ...ir.exactIdentifiers.map((s) => s.toLowerCase())];
  if (queryTokens.length === 0) return [];

  const docs: FieldedDocument[] = index.configs.map((c, i) => ({
    id: String(i),
    fields: {
      config: c.tokens,
      path: c.keyPath ?? [],
    },
  }));

  const scored = scoreFieldedQuery(queryTokens, docs, { config: 6, path: 4 } as any, 30);

  const candidates: CodeCandidate[] = [];
  for (const s of scored) {
    const entry = index.configs[parseInt(s.id)];
    if (!entry) continue;

    const { snippet, context } = buildSnippetFromFile(entry.filePath, entry.line, 1);
    candidates.push({
      candidateType: 'config',
      filePath: entry.filePath,
      line: entry.line,
      symbol: entry.keyPath?.join('.'),
      kind: 'config',
      snippet,
      context,
      score: Math.round(s.score),
      evidence: [`config-${entry.kind}: "${entry.text.substring(0, 80)}"`, ...s.evidence],
      sources: ['config'],
    });
  }

  return candidates;
}
