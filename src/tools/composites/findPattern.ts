import { z } from 'zod';
import { defineTool } from '../registry.js';
import { resolveSearchScope } from '../../resolve/searchScope.js';
import { runPatternSearch } from '../../analysis/pattern/runPatternSearch.js';
import type { FindPatternResult } from '../../search/types.js';

/**
 * Thin wrapper over runPatternSearch().
 * No duplicated file collection or parse loops.
 */
export const findPattern = defineTool({
  name: 'find_pattern',
  description:
    'Search for AST structural patterns across the codebase using ast-grep. Use $VAR for single node, $$$ for multiple nodes. Example: "useEffect($$$)" finds all useEffect calls.',
  schema: z.object({
    pattern: z.string().describe('ast-grep pattern. Use $VAR for single node, $$$ for any sequence.'),
    language: z.enum(['typescript', 'tsx', 'javascript']).default('typescript'),
    paths: z.array(z.string()).optional().describe('Limit search to specific directories (absolute paths)'),
    max_results: z.number().default(50),
    context_lines: z.number().default(1),
    include_tests: z.boolean().default(true).describe('Include test/spec files in results'),
  }),
  async handler(params, engine) {
    const scope = resolveSearchScope(engine.workspaceRoot, params.paths, params.include_tests);

    const { filesScanned, matches, warnings } = runPatternSearch({
      pattern: params.pattern,
      language: params.language,
      scope,
      maxResults: params.max_results,
      contextLines: params.context_lines,
      workspaceRoot: engine.workspaceRoot,
    });

    const result: FindPatternResult = {
      pattern: params.pattern,
      language: params.language,
      filesScanned,
      matchCount: matches.length,
      matches,
      warnings,
    };

    return result;
  },
});
