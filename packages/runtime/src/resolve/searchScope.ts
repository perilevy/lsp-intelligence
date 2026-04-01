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
export interface ScopeCollectionResult {
  files: string[];
  capped: boolean;
  capReason?: 'max-files' | 'max-depth';
}

export function collectScopeFiles(scope: SearchScope, maxFiles: number = 2000): string[] {
  const result = collectScopeFilesWithMeta(scope, maxFiles);
  return result.files;
}

export function collectScopeFilesWithMeta(scope: SearchScope, maxFiles: number = 2000): ScopeCollectionResult {
  const files: string[] = [];
  let hitDepthLimit = false;

  for (const root of scope.roots) {
    const depthHit = walkDir(root, files, scope.includeTests, maxFiles, 0);
    if (depthHit) hitDepthLimit = true;
    if (files.length >= maxFiles) break;
  }

  return {
    files,
    capped: files.length >= maxFiles || hitDepthLimit,
    capReason: files.length >= maxFiles ? 'max-files' : hitDepthLimit ? 'max-depth' : undefined,
  };
}

function walkDir(
  dir: string,
  files: string[],
  includeTests: boolean,
  maxFiles: number,
  depth: number,
): boolean {
  if (depth > 8) return true;
  if (files.length >= maxFiles) return false;
  let hitDepth = false;
  try {
    for (const entry of fs.readdirSync(dir)) {
      if (shouldSkipDir(entry)) continue;
      const full = path.join(dir, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        const sub = walkDir(full, files, includeTests, maxFiles, depth + 1);
        if (sub) hitDepth = true;
      } else if (isCodeFile(full) && !shouldSkipFile(full, stat.size)) {
        if (!includeTests && isTestFile(full)) continue;
        files.push(full);
      }
    }
  } catch {}
  return hitDepth;
}
