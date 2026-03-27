import { z } from 'zod';
import { defineTool } from '../registry.js';
import { resolveSearchScope } from '../../resolve/searchScope.js';
import { parseQuery } from '../../search/query/parseQuery.js';
import { planQuery } from '../../search/query/planQuery.js';
import { getWorkspaceIndex } from '../../search/index/workspaceIndex.js';
import { retrieveBehaviorCandidates } from '../../search/retrievers/behaviorRetriever.js';
import { retrieveIdentifierCandidates } from '../../search/retrievers/identifierRetriever.js';
import { retrieveStructuralCandidates } from '../../search/retrievers/structuralRetriever.js';
import { retrieveDocCandidates } from '../../search/retrievers/docRetriever.js';
import { retrieveConfigCandidates } from '../../search/retrievers/configRetriever.js';
import { mergeCandidates } from '../../search/ranking/mergeCandidates.js';
import { rankCandidates } from '../../search/ranking/rankCandidates.js';
import { assessConfidence } from '../../search/ranking/assessConfidence.js';
import { expandToImplementationRoots } from '../../search/expand/graphExpansion.js';
import type { FindCodeResult } from '../../search/types.js';

export const findCode = defineTool({
  name: 'find_code',
  description:
    'High-level code search: behavior discovery, identifier/API usage search, structural queries, config/route lookup, and implementation-root discovery. The agent does not need to choose the backend — the tool routes automatically based on the query.',
  schema: z.object({
    query: z.string().describe('Natural-language or code-oriented query'),
    paths: z.array(z.string()).optional().describe('Directories/files to narrow search'),
    max_results: z.number().default(10),
    mode: z.enum(['auto', 'behavior', 'identifier', 'structural', 'mixed']).default('auto'),
    family: z.enum(['auth', 'validation', 'fetching', 'errors', 'state', 'flags', 'retry', 'caching']).optional().describe('Optional family override'),
    include_tests: z.boolean().default(false),
  }),
  async handler(params, engine) {
    const startTime = Date.now();
    const warnings: string[] = [];

    const scope = resolveSearchScope(engine.workspaceRoot, params.paths, params.include_tests);
    const ir = parseQuery(params.query, {
      forcedMode: params.mode === 'auto' ? undefined : params.mode,
      forcedFamily: params.family,
    });
    const plan = planQuery(ir);
    const index = getWorkspaceIndex(scope);

    const behavior = plan.retrievers.includes('behavior')
      ? retrieveBehaviorCandidates(ir, scope, index)
      : [];

    const identifier = plan.retrievers.includes('identifier')
      ? retrieveIdentifierCandidates(ir, scope, index)
      : [];

    const structural = plan.retrievers.includes('structural')
      ? retrieveStructuralCandidates(ir, scope, index)
      : [];

    const doc = plan.retrievers.includes('doc')
      ? retrieveDocCandidates(ir, scope, index)
      : [];

    const config = plan.retrievers.includes('config')
      ? retrieveConfigCandidates(ir, scope, index)
      : [];

    const merged = mergeCandidates({ behavior, identifier, structural, doc, config });
    const ranked = await rankCandidates(merged, { ir, plan, engine, scope });

    // Graph expansion for implementation-root promotion
    if (plan.expandGraph && ranked.length > 0) {
      try {
        const expansion = await expandToImplementationRoots(ranked, engine);
        for (const [key, promo] of expansion.promoted) {
          for (const c of ranked) {
            if (`${c.filePath}:${c.line}` === key) {
              c.score += promo.scoreDelta;
              c.evidence.push(...promo.evidence);
              if (!c.sources.includes('graph')) c.sources.push('graph');
            }
          }
        }
        ranked.sort((a, b) => b.score - a.score);
        warnings.push(...expansion.warnings);
      } catch (err: any) {
        warnings.push(`graph-expansion failed: ${err?.message ?? 'unknown'}`);
      }
    }

    const confidence = assessConfidence(ranked, ir, plan);
    const topResults = ranked.slice(0, params.max_results);
    const lspEnriched = ranked.filter((c) => c.sources.includes('lsp')).length;

    // Track partial results
    let partialResult = false;
    if (index.files.size === 0) {
      warnings.push('no files found in scope');
      partialResult = true;
    }
    if (doc.length === 0 && plan.retrievers.includes('doc')) {
      warnings.push('doc retriever returned no results — limited narrative bridge');
    }

    const result: FindCodeResult = {
      query: params.query,
      ir,
      plan,
      confidence,
      candidates: topResults,
      stats: {
        filesIndexed: index.files.size,
        declarationHits: behavior.length,
        usageHits: identifier.length,
        structuralHits: structural.length,
        lspEnriched,
        elapsedMs: Date.now() - startTime,
        partialResult,
      },
      warnings,
    };

    return result;
  },
});
