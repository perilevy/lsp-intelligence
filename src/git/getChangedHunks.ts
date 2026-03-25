import { execSync } from 'child_process';
import * as path from 'path';

export interface ChangedHunk {
  file: string;
  startLine: number;
  endLine: number;
}

/**
 * Parse git diff to extract changed line ranges per file.
 */
export function getChangedHunks(workspaceRoot: string, base: string): ChangedHunk[] {
  try {
    const diff = execSync(`git diff ${base} --unified=0`, { cwd: workspaceRoot, encoding: 'utf-8' });
    return parseHunks(diff, workspaceRoot);
  } catch {
    return [];
  }
}

function parseHunks(diff: string, workspaceRoot: string): ChangedHunk[] {
  const hunks: ChangedHunk[] = [];
  let currentFile = '';

  for (const line of diff.split('\n')) {
    const fileMatch = line.match(/^\+\+\+ b\/(.+)/);
    if (fileMatch) {
      currentFile = path.join(workspaceRoot, fileMatch[1]);
      continue;
    }
    const hunkMatch = line.match(/^@@ .+ \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch && currentFile.match(/\.tsx?$/)) {
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
    const relPath = filePath.startsWith(workspaceRoot)
      ? filePath.slice(workspaceRoot.length + 1)
      : filePath;
    const diff = execSync(`git diff ${base} --name-only -- "${relPath}"`, {
      cwd: workspaceRoot,
      encoding: 'utf-8',
    });
    return diff.trim().length > 0;
  } catch {
    return false;
  }
}
