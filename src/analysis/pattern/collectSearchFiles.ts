import * as fs from 'fs';
import * as path from 'path';
import type { SearchScope } from '../../search/types.js';
import { SKIP_DIRS } from '../../engine/types.js';

const TEST_PATTERN = /\.(spec|test|stories)\.(ts|tsx|js|jsx)$/;

/**
 * Collect files matching a language within a search scope.
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
      if (SKIP_DIRS.has(entry)) continue;
      const full = path.join(dir, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walkDir(full, files, extensions, includeTests, maxFiles, depth + 1);
      } else if (extensions.some((e) => entry.endsWith(e)) && !entry.endsWith('.d.ts')) {
        if (!includeTests && TEST_PATTERN.test(entry)) continue;
        files.push(full);
      }
    }
  } catch {}
}
