import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { getGitContext } from './getGitRoot.js';

/**
 * Get list of changed files between base and HEAD.
 * Uses repo-relative paths for git, returns absolute workspace paths.
 */
export function getChangedFiles(
  workspaceRoot: string,
  base: string,
  filter: (f: string) => boolean = (f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f) && !f.endsWith('.d.ts'),
): string[] {
  try {
    const ctx = getGitContext(workspaceRoot);
    const cwd = ctx?.repoRoot ?? workspaceRoot;

    const diff = execSync(`git diff ${base} --name-only`, { cwd, encoding: 'utf-8' });
    return diff
      .trim()
      .split('\n')
      .filter((f) => f && filter(f))
      .map((f) => path.resolve(cwd, f))
      .filter((f) => fs.existsSync(f))
      // Only include files within the workspace root
      .filter((f) => f.startsWith(workspaceRoot));
  } catch {
    return [];
  }
}
