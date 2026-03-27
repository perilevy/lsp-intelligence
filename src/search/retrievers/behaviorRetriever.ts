import type { QueryIR, SearchScope, WorkspaceIndex, CodeCandidate } from '../types.js';
import { BEHAVIOR_FAMILIES } from '../families/behaviorFamilies.js';
import { buildSnippetFromFile } from '../../analysis/ts/snippets.js';

/**
 * Prefix-based partial match with minimum length guard.
 * Prevents false positives like 'permission'.includes('is').
 */
function isStrongPartialMatch(a: string, b: string): boolean {
  if (a.length < 4 || b.length < 4) return false;
  return a.startsWith(b) || b.startsWith(a);
}

/**
 * Retrieve declaration-oriented candidates based on behavior family matching.
 * Uses declaration index + family classifier/expansion terms + file/symbol hints.
 * Does NOT use exact identifier matching — that's the identifier retriever's job.
 */
export function retrieveBehaviorCandidates(
  ir: QueryIR,
  scope: SearchScope,
  index: WorkspaceIndex,
): CodeCandidate[] {
  const candidates: CodeCandidate[] = [];
  const matchedFamilies = BEHAVIOR_FAMILIES.filter((f) => ir.familyScores[f.id] > 0);

  if (matchedFamilies.length === 0 && ir.nlTokens.length === 0) return [];

  // Score each declaration against NL tokens + family hints
  for (const decl of index.declarations) {
    let score = 0;
    const evidence: string[] = [];

    // Family symbol hints
    for (const family of matchedFamilies) {
      for (const hint of family.symbolHints) {
        for (const tok of decl.symbolTokens) {
          if (tok === hint) { score += 5; evidence.push(`symbol-hint: ${hint}`); break; }
          if (isStrongPartialMatch(tok, hint)) { score += 2; evidence.push(`symbol-partial: ${hint}~${tok}`); break; }
        }
      }
      for (const hint of family.fileHints) {
        for (const tok of decl.pathTokens) {
          if (tok.includes(hint)) { score += 3; evidence.push(`file-hint: ${hint}`); break; }
        }
      }
    }

    // NL token matching against symbol tokens
    for (const nlTok of ir.nlTokens) {
      for (const symTok of decl.symbolTokens) {
        if (symTok === nlTok) { score += 4; evidence.push(`nl-match: ${nlTok}`); break; }
        if (isStrongPartialMatch(symTok, nlTok)) { score += 2; evidence.push(`nl-partial: ${nlTok}~${symTok}`); break; }
      }
    }

    // Export bonus
    if (decl.isExported && score > 0) {
      score += 2;
      evidence.push('exported');
    }

    if (score > 0) {
      const { snippet, context } = buildSnippetFromFile(decl.filePath, decl.line, 1);
      candidates.push({
        candidateType: 'declaration',
        filePath: decl.filePath,
        line: decl.line,
        column: decl.column,
        symbol: decl.symbol,
        kind: decl.kind as CodeCandidate['kind'],
        snippet,
        context,
        score,
        evidence,
        sources: ['behavior'],
      });
    }
  }

  return candidates.sort((a, b) => b.score - a.score);
}
