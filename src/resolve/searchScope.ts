import * as fs from 'fs';
import * as path from 'path';
import type { SearchScope } from '../search/types.js';
import { SKIP_DIRS } from '../engine/types.js';

const TEST_PATTERN = /\.(spec|test|stories)\.(ts|tsx|js|jsx)$/;

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
 * Collect all TypeScript/TSX files within the search scope.
 * Respects includeTests and SKIP_DIRS.
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
      if (SKIP_DIRS.has(entry)) continue;
      const full = path.join(dir, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walkDir(full, files, includeTests, maxFiles, depth + 1);
      } else if ((entry.endsWith('.ts') || entry.endsWith('.tsx')) && !entry.endsWith('.d.ts')) {
        if (!includeTests && TEST_PATTERN.test(entry)) continue;
        files.push(full);
      }
    }
  } catch {}
}
