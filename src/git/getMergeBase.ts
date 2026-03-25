import { execSync } from 'child_process';

/**
 * Get the merge-base between HEAD and the target branch.
 * Tries main, then master, then falls back to HEAD~1.
 */
export function getMergeBase(workspaceRoot: string, target?: string): string {
  if (target) {
    try {
      return execSync(`git merge-base HEAD ${target}`, { cwd: workspaceRoot, encoding: 'utf-8' }).trim();
    } catch {
      return target;
    }
  }

  for (const branch of ['main', 'master', 'develop']) {
    try {
      return execSync(`git merge-base HEAD ${branch}`, { cwd: workspaceRoot, encoding: 'utf-8' }).trim();
    } catch {}
  }

  return 'HEAD~1';
}
