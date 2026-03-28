import { execSync } from 'child_process';
import * as path from 'path';

export interface GitContext {
  repoRoot: string;
  workspaceRoot: string;
}

let cachedContext: GitContext | null = null;

/**
 * Resolve the git repo root and workspace root.
 * The workspace root may be a subdirectory of the repo root (nested workspace).
 * Cached for the session.
 */
export function getGitContext(workspaceRoot: string): GitContext | null {
  if (cachedContext && cachedContext.workspaceRoot === workspaceRoot) return cachedContext;

  try {
    const repoRoot = execSync('git rev-parse --show-toplevel', {
      cwd: workspaceRoot,
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();

    cachedContext = { repoRoot, workspaceRoot };
    return cachedContext;
  } catch {
    return null;
  }
}

/**
 * Convert a workspace-relative or absolute path to a repo-relative path.
 * This is what git commands (git show, git diff) need.
 */
export function toRepoRelativePath(filePath: string, ctx: GitContext): string {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(ctx.workspaceRoot, filePath);
  return path.relative(ctx.repoRoot, abs);
}
