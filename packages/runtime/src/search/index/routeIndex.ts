import type { RouteIndexEntry, SearchScope } from '../types.js';
import { collectScopeFiles } from '../../resolve/searchScope.js';
import { parseSourceFile } from '../../analysis/ts/parseSourceFile.js';
import { extractRoutes } from '../../analysis/ts/extractRoutes.js';

/**
 * Build the route index from code files in scope.
 * Extracts Express/Fastify/Next route definitions using TS AST.
 */
export function indexRoutes(scope: SearchScope): RouteIndexEntry[] {
  const entries: RouteIndexEntry[] = [];
  const files = collectScopeFiles(scope, 500);

  for (const filePath of files) {
    const sf = parseSourceFile(filePath);
    if (!sf) continue;
    entries.push(...extractRoutes(sf));
  }

  return entries;
}
