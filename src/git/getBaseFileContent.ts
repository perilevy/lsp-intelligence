import { execSync } from 'child_process';
import { relativePath } from '../engine/positions.js';

/**
 * Get file content at a specific git ref.
 * Returns null if file didn't exist at that ref.
 */
export function getBaseFileContent(
  filePath: string,
  base: string,
  workspaceRoot: string,
): string | null {
  try {
    const relPath = relativePath(filePath, workspaceRoot);
    return execSync(`git show ${base}:${relPath}`, { cwd: workspaceRoot, encoding: 'utf-8' });
  } catch {
    return null;
  }
}
