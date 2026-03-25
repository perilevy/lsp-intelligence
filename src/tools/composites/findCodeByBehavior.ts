import { z } from 'zod';
import { defineTool } from '../registry.js';
import { relativePath } from '../../engine/positions.js';
import { formatHover } from '../../format/markdown.js';
import type { Hover } from 'vscode-languageserver-protocol';
import { DEFAULT_TIMEOUTS } from '../../engine/types.js';
import { buildLexicalIndex } from '../../search/lexicalIndex.js';
import { normalizeQuery, lexicalRecall } from '../../search/lexicalQuery.js';
import { buildAstShortlist, astSearch } from '../../search/astSearch.js';
import { mergeCandidates, applyPenalties, assessConfidence } from '../../search/rankCandidates.js';
import type { BehaviorCandidate, FindCodeByBehaviorResult } from '../../search/types.js';

// Cache the lexical index with TTL
const INDEX_TTL_MS = 10_000;
let cachedIndex: { root: string; builtAt: number; entries: ReturnType<typeof buildLexicalIndex> } | null = null;

export const findCodeByBehavior = defineTool({
  name: 'find_code_by_behavior',
  description:
    'Find likely implementation entrypoints for a behavior described in natural language. Combines keyword search, AST structural patterns, and LSP enrichment. Good for: auth, validation, fetching, error handling, state management, feature flags.',
  schema: z.object({
    query: z.string().describe('Natural language description, e.g. "permission checks" or "JWT validation"'),
    max_results: z.number().default(10).describe('Maximum results to return'),
  }),
  async handler(params, engine) {
    const startTime = Date.now();

    // Step 1: Normalize query
    const normalized = normalizeQuery(params.query);

    // Step 2: Build or reuse lexical index
    if (
      !cachedIndex ||
      cachedIndex.root !== engine.workspaceRoot ||
      Date.now() - cachedIndex.builtAt > INDEX_TTL_MS
    ) {
      cachedIndex = { root: engine.workspaceRoot, builtAt: Date.now(), entries: buildLexicalIndex(engine.workspaceRoot) };
    }

    // Step 3: Lexical recall
    const lexicalCandidates = lexicalRecall(cachedIndex.entries, normalized, 100);

    // Step 4: AST shortlist + search
    const AST_FILE_CAP = normalized.behaviorFamilies.length > 1 ? 80 : 30;
    const shortlist = buildAstShortlist(engine.workspaceRoot, normalized, lexicalCandidates, AST_FILE_CAP);
    const { candidates: astCandidates, filesScanned, matchCount } = astSearch(
      shortlist, normalized, engine.workspaceRoot,
    );

    // Step 5: Merge + deduplicate + penalties
    const merged = mergeCandidates(lexicalCandidates, astCandidates);
    const ranked = applyPenalties(merged);

    // Step 6: LSP enrichment (top 15 only)
    const enrichLimit = Math.min(15, ranked.length);
    for (let i = 0; i < enrichLimit; i++) {
      const c = ranked[i];
      try {
        const { uri } = await engine.prepareFile(c.filePath);
        if (c.symbol) {
          const hover = await engine.request<Hover | null>(
            'textDocument/hover',
            { textDocument: { uri }, position: { line: c.line - 1, character: 0 } },
            5000,
          ).catch(() => null);
          if (hover) {
            c.signature = formatHover(hover).substring(0, 200);
          }
        }
        if (!c.sources.includes('lsp')) c.sources.push('lsp');
      } catch {}
    }

    // Step 7: Confidence assessment
    const confidence = assessConfidence(ranked);
    const topResults = ranked.slice(0, params.max_results);

    // Step 8: Format output
    const result: FindCodeByBehaviorResult = {
      query: params.query,
      normalizedQuery: normalized,
      stats: {
        lexicalCandidates: lexicalCandidates.length,
        astFilesScanned: filesScanned,
        astMatches: matchCount,
        enrichedCandidates: enrichLimit,
      },
      confidence,
      candidates: topResults,
    };

    // Relativize file paths in candidates for output
    for (const c of result.candidates) {
      c.filePath = relativePath(c.filePath, engine.workspaceRoot);
    }
    (result as any).elapsedMs = Date.now() - startTime;
    (result as any).warnings = [];

    return result;
  },
});

// formatResult removed — tool now returns structured JSON directly
