import type { QueryIR, SearchScope, WorkspaceIndex, CodeCandidate } from '../types.js';
import type { EffectiveSearchSpec } from '../query/compileEffectiveSearchSpec.js';
import { buildSnippetFromFile } from '../../analysis/ts/snippets.js';

/**
 * Retrieve usage-oriented candidates based on exact identifier matching.
 * Uses the compiled spec's identifiers (merged from parser + recipes).
 */
export function retrieveIdentifierCandidates(
  ir: QueryIR,
  scope: SearchScope,
  index: WorkspaceIndex,
  spec?: EffectiveSearchSpec,
): CodeCandidate[] {
  const candidates: CodeCandidate[] = [];
  const exactIds = spec?.exactIdentifiers ?? ir.exactIdentifiers;
  const dottedIds = spec?.dottedIdentifiers ?? ir.dottedIdentifiers;

  if (exactIds.length === 0 && dottedIds.length === 0) return [];

  for (const usage of index.usages) {
    let score = 0;
    const evidence: string[] = [];

    // Exact identifier match
    for (const id of exactIds) {
      if (usage.identifier === id || usage.normalizedIdentifier === id) {
        score += 10;
        evidence.push(`exact-identifier: ${id}`);
      }
    }

    // Dotted identifier match (Promise.all, React.useEffect)
    for (const id of dottedIds) {
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
