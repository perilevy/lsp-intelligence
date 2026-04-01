import { execSync } from 'child_process';
import { getGitContext, toRepoRelativePath } from './getGitRoot.js';

/**
 * Get file content at a specific git ref.
 * Uses repo-relative paths so it works when workspace is a subdirectory.
 * Returns null if file didn't exist at that ref.
 */
export function getBaseFileContent(
  filePath: string,
  base: string,
  workspaceRoot: string,
): string | null {
  try {
    const ctx = getGitContext(workspaceRoot);
    if (!ctx) return null;

    const repoRelPath = toRepoRelativePath(filePath, ctx);
    return execSync(`git show ${base}:${repoRelPath}`, {
      cwd: ctx.repoRoot,
      encoding: 'utf-8',
    });
  } catch {
    return null;
  }
}
