import type { QueryIR, SearchScope, WorkspaceIndex, CodeCandidate } from '../types.js';
import type { EffectiveSearchSpec } from '../query/compileEffectiveSearchSpec.js';
import { BEHAVIOR_FAMILIES } from '../families/behaviorFamilies.js';
import { scoreFieldedQuery, type FieldedDocument } from '../ranking/fieldedTextRanker.js';
import { buildSnippetFromFile } from '../../analysis/ts/snippets.js';

/**
 * Retrieve declaration-oriented candidates based on behavior family matching.
 * Uses the compiled spec's behaviorTerms (merged from parser + recipes).
 */
export function retrieveBehaviorCandidates(
  ir: QueryIR,
  scope: SearchScope,
  index: WorkspaceIndex,
  spec?: EffectiveSearchSpec,
): CodeCandidate[] {
  const matchedFamilies = BEHAVIOR_FAMILIES.filter((f) => ir.familyScores[f.id] > 0);
  if (matchedFamilies.length === 0 && ir.nlTokens.length === 0) return [];

  // Expand query tokens with family expansion terms
  const expansionTerms: string[] = [];
  for (const family of matchedFamilies) {
    expansionTerms.push(...family.expansionTerms);
  }

  // Build fielded documents from declarations + their attached docs
  const docsBySymbol = new Map<string, string[]>();
  for (const d of index.docs) {
    if (d.attachedSymbol) {
      const existing = docsBySymbol.get(`${d.filePath}:${d.attachedSymbol}`) ?? [];
      existing.push(...d.tokens);
      docsBySymbol.set(`${d.filePath}:${d.attachedSymbol}`, existing);
    }
  }

  const docs: FieldedDocument[] = index.declarations.map((decl, i) => {
    const docTokens = docsBySymbol.get(`${decl.filePath}:${decl.symbol}`) ?? [];
    return {
      id: String(i),
      fields: {
        symbol: decl.symbolTokens,
        path: decl.pathTokens,
        docs: docTokens,
      },
    };
  });

  // Query tokens: use spec behaviorTerms if available, plus family expansion
  const baseTerms = spec?.behaviorTerms ?? [...ir.nlTokens, ...ir.codeTokens];
  const queryTokens = [...new Set([...baseTerms, ...expansionTerms])];
  const scored = scoreFieldedQuery(queryTokens, docs, { symbol: 8, path: 3, docs: 5 }, 100);

  const candidates: CodeCandidate[] = [];
  for (const s of scored) {
    const decl = index.declarations[parseInt(s.id)];
    if (!decl) continue;

    // Family hint bonus (additive, on top of fielded score)
    let familyBonus = 0;
    const familyEvidence: string[] = [];
    for (const family of matchedFamilies) {
      for (const hint of family.symbolHints) {
        if (decl.symbolTokens.some((t) => t === hint)) {
          familyBonus += 3;
          familyEvidence.push(`family-hint: ${family.id}:${hint}`);
        }
      }
      for (const hint of family.fileHints) {
        if (decl.pathTokens.some((t) => t.includes(hint))) {
          familyBonus += 2;
          familyEvidence.push(`family-file: ${family.id}:${hint}`);
        }
      }
    }

    // Export bonus
    const exportBonus = decl.isExported ? 2 : 0;

    const totalScore = Math.round(s.score) + familyBonus + exportBonus;
    const evidence = [...s.evidence, ...familyEvidence];
    if (decl.isExported) evidence.push('exported');

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
      score: totalScore,
      evidence,
      sources: ['behavior'],
    });
  }

  return candidates.sort((a, b) => b.score - a.score);
}
