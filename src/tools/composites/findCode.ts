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
import { coalesceCandidates } from '../../search/ranking/coalesceCandidates.js';
import { rankCandidates } from '../../search/ranking/rankCandidates.js';
import { assessConfidence } from '../../search/ranking/assessConfidence.js';
import { retrieveTextPatternCandidates } from '../../search/retrievers/textPatternRetriever.js';
import { compileEffectiveSearchSpec } from '../../search/query/compileEffectiveSearchSpec.js';
import { expandToImplementationRoots } from '../../search/expand/graphExpansion.js';
import { absoluteCandidateKey } from '../../search/ranking/candidateIdentity.js';
import { buildDebugTrace } from '../../search/debug/trace.js';
import { relativePath } from '../../engine/positions.js';
import type { FindCodeResult, FindCodeDebugInfo } from '../../search/types.js';

export const findCode = defineTool({
  name: 'find_code',
  description:
    'High-level code search: behavior discovery, identifier/API usage search, structural queries, config/route lookup, and implementation-root discovery. Routes automatically — the agent does not need to choose the backend.',
  schema: z.object({
    query: z.string().describe('Natural-language or code-oriented search query'),
    paths: z.array(z.string()).optional().describe('Optional directories/files to narrow search'),
    max_results: z.number().default(10),
    include_tests: z.boolean().default(false),
    focus: z.enum(['auto', 'implementation', 'usage', 'pattern', 'config']).default('auto'),
    debug: z.boolean().optional().describe('Include debug trace in output'),
  }),
  async handler(params, engine) {
    const startTime = Date.now();
    const warnings: string[] = [];

    const scope = resolveSearchScope(engine.workspaceRoot, params.paths, params.include_tests);
    const ir = parseQuery(params.query, { forcedFocus: params.focus });
    const plan = planQuery(ir);
    const index = getWorkspaceIndex(scope);
    const spec = compileEffectiveSearchSpec(ir, plan);

    const behavior = plan.retrievers.includes('behavior')
      ? retrieveBehaviorCandidates(ir, scope, index, spec)
      : [];

    const identifier = plan.retrievers.includes('identifier')
      ? retrieveIdentifierCandidates(ir, scope, index, spec)
      : [];

    const structural = plan.retrievers.includes('structural')
      ? retrieveStructuralCandidates(ir, scope, index, spec)
      : [];

    const doc = plan.retrievers.includes('doc')
      ? retrieveDocCandidates(ir, scope, index, spec)
      : [];

    const config = plan.retrievers.includes('config')
      ? retrieveConfigCandidates(ir, scope, index, spec)
      : [];

    const regex = plan.retrievers.includes('regex')
      ? retrieveTextPatternCandidates(ir, scope, index, spec)
      : [];

    const merged = mergeCandidates({ behavior, identifier, structural, regex, doc, config });
    const coalesced = coalesceCandidates(merged);
    const ranked = await rankCandidates(coalesced, { ir, plan, engine, scope });

    // Graph expansion for implementation-root promotion
    let graphExpanded = 0;
    if (plan.expandGraph && ranked.length > 0) {
      try {
        const expansion = await expandToImplementationRoots(ranked, engine);
        graphExpanded = expansion.promoted.size;

        // Apply score promotions/demotions using canonical keys
        for (const [key, promo] of expansion.promoted) {
          for (const c of ranked) {
            if (absoluteCandidateKey(c) === key) {
              c.score += promo.scoreDelta;
              c.evidence.push(...promo.evidence);
              if (!c.sources.includes('graph')) c.sources.push('graph');
            }
          }
        }

        // Merge derived candidates (implementation roots found by LSP)
        for (const derived of expansion.derived) {
          derived.filePath = relativePath(derived.filePath, engine.workspaceRoot);
          ranked.push(derived);
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
    const hasCodeResults = behavior.length + identifier.length + structural.length + regex.length > 0;
    const hasConfigResults = config.length > 0;
    const hasDocResults = doc.length > 0;

    if (index.files.size === 0 && !hasConfigResults) {
      warnings.push('no files found in scope');
      partialResult = true;
    }

    // Debug info
    let debug: FindCodeDebugInfo | undefined;
    if (params.debug) {
      debug = buildDebugTrace(ir, plan, topResults, {
        behavior: behavior.length,
        identifier: identifier.length,
        structural: structural.length,
        regex: regex.length,
        doc: doc.length,
        config: config.length,
      });
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
        regexHits: regex.length,
        docHits: doc.length,
        configHits: config.length,
        graphExpanded,
        lspEnriched,
        elapsedMs: Date.now() - startTime,
        partialResult,
      },
      warnings,
      debug,
    };

    return result;
  },
});
