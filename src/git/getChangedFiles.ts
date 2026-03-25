import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Get list of changed TypeScript files between base and HEAD.
 */
export function getChangedFiles(
  workspaceRoot: string,
  base: string,
  filter: (f: string) => boolean = (f) => /\.tsx?$/.test(f) && !f.endsWith('.d.ts'),
): string[] {
  try {
    const diff = execSync(`git diff ${base} --name-only`, { cwd: workspaceRoot, encoding: 'utf-8' });
    return diff
      .trim()
      .split('\n')
      .filter((f) => f && filter(f))
      .map((f) => path.join(workspaceRoot, f))
      .filter((f) => fs.existsSync(f));
  } catch {
    return [];
  }
}
