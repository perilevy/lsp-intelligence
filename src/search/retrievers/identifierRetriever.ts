import type { QueryIR, SearchScope, WorkspaceIndex, CodeCandidate } from '../types.js';
import { buildSnippetFromFile } from '../../analysis/ts/snippets.js';

/**
 * Retrieve usage-oriented candidates based on exact identifier matching.
 * Uses usage index — call expressions, member calls, imports, JSX tags.
 * This is the missing backend that makes useEffect, Promise.all queries work.
 */
export function retrieveIdentifierCandidates(
  ir: QueryIR,
  scope: SearchScope,
  index: WorkspaceIndex,
): CodeCandidate[] {
  const candidates: CodeCandidate[] = [];

  if (ir.exactIdentifiers.length === 0 && ir.dottedIdentifiers.length === 0) return [];

  for (const usage of index.usages) {
    let score = 0;
    const evidence: string[] = [];

    // Exact identifier match
    for (const id of ir.exactIdentifiers) {
      if (usage.identifier === id || usage.normalizedIdentifier === id) {
        score += 10;
        evidence.push(`exact-identifier: ${id}`);
      }
    }

    // Dotted identifier match (Promise.all, React.useEffect)
    for (const id of ir.dottedIdentifiers) {
      if (usage.identifier === id) {
        score += 10;
        evidence.push(`dotted-identifier: ${id}`);
      } else if (usage.identifier.endsWith(id.split('.').pop() ?? '')) {
        score += 5;
        evidence.push(`dotted-partial: ${id}`);
      }
    }

    if (score === 0) continue;

    // Usage kind bonus
    if (usage.kind === 'call' || usage.kind === 'member-call') {
      score += 2;
      evidence.push(`usage-kind: ${usage.kind}`);
    } else if (usage.kind === 'import') {
      score += 1;
      evidence.push('usage-kind: import');
    }

    // Enclosing symbol context
    if (usage.enclosingSymbol) {
      evidence.push(`enclosing: ${usage.enclosingSymbol}`);
    }

    const { snippet, context } = buildSnippetFromFile(usage.filePath, usage.line, 1);
    candidates.push({
      candidateType: 'usage',
      filePath: usage.filePath,
      line: usage.line,
      column: usage.column,
      matchedIdentifier: usage.identifier,
      enclosingSymbol: usage.enclosingSymbol,
      enclosingKind: usage.enclosingKind,
      kind: 'usage',
      snippet,
      context,
      score,
      evidence,
      sources: ['identifier'],
    });
  }

  return candidates.sort((a, b) => b.score - a.score);
}
