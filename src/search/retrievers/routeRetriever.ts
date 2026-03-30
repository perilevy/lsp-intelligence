import type { SearchScope, WorkspaceIndex, CodeCandidate } from '../types.js';
import type { EffectiveSearchSpec } from '../query/compileEffectiveSearchSpec.js';
import { buildSnippetFromFile } from '../../analysis/ts/snippets.js';

/**
 * Retrieve route definition candidates from the route index.
 * Does NOT use outbound fetch/axios as route-definition evidence.
 */
export function retrieveRouteCandidates(
  spec: EffectiveSearchSpec,
  scope: SearchScope,
  index: WorkspaceIndex,
): CodeCandidate[] {
  if (index.routes.length === 0) return [];

  const queryTokens = [...spec.routeTerms, ...spec.behaviorTerms];
  if (queryTokens.length === 0) return [];

  const candidates: CodeCandidate[] = [];

  for (const route of index.routes) {
    let score = 0;
    const evidence: string[] = [];

    // Path match — strongest signal
    if (route.path) {
      const pathTokens = route.path.toLowerCase().split(/[/\-_]+/).filter((t) => t.length > 1);
      for (const qt of queryTokens) {
        if (pathTokens.some((pt) => pt === qt || pt.includes(qt))) {
          score += 6;
          evidence.push(`route-path-match: ${qt} in ${route.path}`);
        }
      }
    }

    // Method match
    if (route.method) {
      const methodLower = route.method.toLowerCase();
      if (queryTokens.some((qt) => qt === methodLower || qt === route.method)) {
        score += 4;
        evidence.push(`method-match: ${route.method}`);
      }
    }

    // Framework/token overlap
    for (const qt of queryTokens) {
      if (route.tokens.some((rt) => rt === qt)) {
        score += 2;
        evidence.push(`token-match: ${qt}`);
      }
    }

    // Route-term boost — query explicitly asks about routes/endpoints
    if (spec.routeTerms.length > 0) {
      score += 3;
      evidence.push('route-intent-boost');
    }

    if (score === 0) continue;

    const { snippet, context } = buildSnippetFromFile(route.filePath, route.line, 1);
    candidates.push({
      candidateType: 'route',
      filePath: route.filePath,
      line: route.line,
      symbol: route.enclosingSymbol,
      kind: 'function',
      snippet,
      context,
      score,
      evidence: [`route-${route.framework}: "${route.text}"`, ...evidence],
      sources: ['route'],
    });
  }

  return candidates.sort((a, b) => b.score - a.score);
}
