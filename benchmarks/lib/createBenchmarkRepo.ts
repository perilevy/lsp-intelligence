import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

export interface BenchmarkRepo {
  root: string;
  baseSha: string;
  cleanup(): Promise<void>;
}

/**
 * Create a temporary git repo from a base/head fixture pair.
 * 1. Copies base/ into temp dir
 * 2. git init + commit base
 * 3. Overlays head/ onto working tree
 * 4. Returns repo root and base SHA for tool invocation
 */
export async function createBenchmarkRepo(caseDir: string): Promise<BenchmarkRepo> {
  const baseDir = path.join(caseDir, 'base');
  const headDir = path.join(caseDir, 'head');

  if (!fs.existsSync(baseDir) || !fs.existsSync(headDir)) {
    throw new Error(`Benchmark case missing base/ or head/ at ${caseDir}`);
  }

  // Use realpathSync to get the canonical path — on macOS /tmp is a symlink
  // and git rev-parse --show-toplevel returns the resolved path, so the two
  // must match for path-prefix filters inside getChangedFiles to work.
  const tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-bench-')));

  // Copy base
  copyDir(baseDir, tmpRoot);

  // Git init + commit
  execSync('git init -b main', { cwd: tmpRoot, stdio: 'ignore' });
  execSync('git add -A', { cwd: tmpRoot, stdio: 'ignore' });
  execSync('git -c user.name="bench" -c user.email="bench@test" commit -m "base"', { cwd: tmpRoot, stdio: 'ignore' });
  const baseSha = execSync('git rev-parse HEAD', { cwd: tmpRoot, encoding: 'utf-8' }).trim();

  // Overlay head
  copyDir(headDir, tmpRoot);

  return {
    root: tmpRoot,
    baseSha,
    async cleanup() {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    },
  };
}

function copyDir(src: string, dest: string): void {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
