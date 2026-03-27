import * as fs from 'fs';
import * as path from 'path';
import type { SearchScope } from '../search/types.js';
import { isCodeFile, isTestFile, shouldSkipDir, shouldSkipFile } from '../search/fileKinds.js';

/**
 * Resolve a search scope from user input.
 * This scope is applied to ALL retrieval backends — declarations, usages, structural, pattern.
 */
export function resolveSearchScope(
  workspaceRoot: string,
  paths?: string[],
  includeTests?: boolean,
): SearchScope {
  const roots = paths && paths.length > 0
    ? paths.map((p) => path.isAbsolute(p) ? p : path.join(workspaceRoot, p))
    : [workspaceRoot];

  return {
    roots,
    includeTests: includeTests ?? false,
  };
}

/**
 * Collect all code files (TS/TSX/JS/JSX/MJS/CJS) within the search scope.
 * Skips dot-prefixed dirs, build output, minified/bundled files, and oversized files.
 */
export function collectScopeFiles(scope: SearchScope, maxFiles: number = 2000): string[] {
  const files: string[] = [];

  for (const root of scope.roots) {
    walkDir(root, files, scope.includeTests, maxFiles, 0);
    if (files.length >= maxFiles) break;
  }

  return files;
}

function walkDir(
  dir: string,
  files: string[],
  includeTests: boolean,
  maxFiles: number,
  depth: number,
): void {
  if (depth > 8 || files.length >= maxFiles) return;
  try {
    for (const entry of fs.readdirSync(dir)) {
      if (shouldSkipDir(entry)) continue;
      const full = path.join(dir, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walkDir(full, files, includeTests, maxFiles, depth + 1);
      } else if (isCodeFile(full) && !shouldSkipFile(full, stat.size)) {
        if (!includeTests && isTestFile(full)) continue;
        files.push(full);
      }
    }
  } catch {}
}
