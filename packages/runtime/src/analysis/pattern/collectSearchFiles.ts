import * as fs from 'fs';
import * as path from 'path';
import type { SearchScope } from '../../search/types.js';
import { isTestFile, shouldSkipDir, shouldSkipFile } from '../../search/fileKinds.js';

/**
 * Collect files matching a set of extensions within a search scope.
 * Skips dot-prefixed dirs, build output, minified/bundled files, and oversized files.
 */
export function collectSearchFiles(
  scope: SearchScope,
  extensions: string[],
  maxFiles: number,
): string[] {
  const files: string[] = [];

  for (const root of scope.roots) {
    walkDir(root, files, extensions, scope.includeTests, maxFiles, 0);
    if (files.length >= maxFiles) break;
  }

  return files;
}

function walkDir(
  dir: string,
  files: string[],
  extensions: string[],
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
        walkDir(full, files, extensions, includeTests, maxFiles, depth + 1);
      } else if (extensions.some((e) => entry.endsWith(e)) && !shouldSkipFile(full, stat.size)) {
        if (!includeTests && isTestFile(full)) continue;
        files.push(full);
      }
    }
  } catch {}
}
