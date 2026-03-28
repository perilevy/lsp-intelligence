import { execSync } from 'child_process';
import * as path from 'path';
import { getGitContext, toRepoRelativePath } from './getGitRoot.js';

export interface ChangedHunk {
  file: string;
  startLine: number;
  endLine: number;
}

/**
 * Parse git diff to extract changed line ranges per file.
 * Uses repo-relative paths for git commands.
 */
export function getChangedHunks(workspaceRoot: string, base: string): ChangedHunk[] {
  try {
    const ctx = getGitContext(workspaceRoot);
    const cwd = ctx?.repoRoot ?? workspaceRoot;
    const diff = execSync(`git diff ${base} --unified=0`, { cwd, encoding: 'utf-8' });
    return parseHunks(diff, cwd, workspaceRoot);
  } catch {
    return [];
  }
}

function parseHunks(diff: string, gitRoot: string, workspaceRoot: string): ChangedHunk[] {
  const hunks: ChangedHunk[] = [];
  let currentFile = '';

  for (const line of diff.split('\n')) {
    const fileMatch = line.match(/^\+\+\+ b\/(.+)/);
    if (fileMatch) {
      currentFile = path.resolve(gitRoot, fileMatch[1]);
      continue;
    }
    const hunkMatch = line.match(/^@@ .+ \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch && currentFile.match(/\.(ts|tsx|js|jsx|mjs|cjs)$/) && currentFile.startsWith(workspaceRoot)) {
      const start = parseInt(hunkMatch[1]);
      const count = parseInt(hunkMatch[2] ?? '1');
      hunks.push({ file: currentFile, startLine: start, endLine: start + count - 1 });
    }
  }
  return hunks;
}

/**
 * Check if a specific file changed between base and HEAD.
 */
export function fileChangedInBranch(filePath: string, base: string, workspaceRoot: string): boolean {
  try {
    const ctx = getGitContext(workspaceRoot);
    if (!ctx) return false;
    const repoRelPath = toRepoRelativePath(filePath, ctx);
    const diff = execSync(`git diff ${base} --name-only -- "${repoRelPath}"`, {
      cwd: ctx.repoRoot,
      encoding: 'utf-8',
    });
    return diff.trim().length > 0;
  } catch {
    return false;
  }
}
