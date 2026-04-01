import * as path from 'path';
import ts from 'typescript';

export const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] as const;
export const CONFIG_EXTENSIONS = ['.json', '.yaml', '.yml', '.toml'] as const;

const TEST_PATTERN = /\.(spec|test|stories)\.(ts|tsx|js|jsx|mjs|cjs)$/;

// --- Directory exclusion ---

const SKIP_DIR_NAMES = new Set([
  'node_modules', 'dist', 'build', 'es', 'coverage',
  '__pycache__', '__generated__', '__mocks__',
]);

export function shouldSkipDir(dirName: string): boolean {
  if (dirName.startsWith('.')) return true;
  return SKIP_DIR_NAMES.has(dirName);
}

// --- File exclusion ---

const SKIP_FILE_PATTERNS = [
  /\.min\.(js|cjs|mjs)$/,
  /\.bundle\.(js|cjs|mjs)$/,
  /\.map$/,
  /\.lock$/,
  /-lock\.json$/,
];

const MAX_FILE_SIZE = 500_000;

export function shouldSkipFile(filePath: string, sizeBytes?: number): boolean {
  const basename = path.basename(filePath);
  if (basename.endsWith('.d.ts')) return true;
  if (SKIP_FILE_PATTERNS.some((p) => p.test(basename))) return true;
  if (sizeBytes !== undefined && sizeBytes > MAX_FILE_SIZE) return true;
  return false;
}

// --- Env file classification ---

/** Real .env files that may contain secrets. Excluded from indexing by default. */
export function isSecretEnvFile(filePath: string): boolean {
  const basename = path.basename(filePath);
  if (!basename.startsWith('.env')) return false;
  // Allow safe templates/examples
  if (isSafeEnvTemplateFile(filePath)) return false;
  return true;
}

/** Non-secret env template/example files. Safe to index. */
export function isSafeEnvTemplateFile(filePath: string): boolean {
  const basename = path.basename(filePath).toLowerCase();
  return basename === '.env.example' ||
    basename === '.env.template' ||
    basename === '.env.sample';
}

// --- Code/config/test classification ---

export function isCodeFile(filePath: string): boolean {
  if (shouldSkipFile(filePath)) return false;
  return CODE_EXTENSIONS.some((ext) => filePath.endsWith(ext));
}

export function isConfigFile(filePath: string): boolean {
  return CONFIG_EXTENSIONS.some((ext) => filePath.endsWith(ext));
}

export function isTestFile(filePath: string): boolean {
  return TEST_PATTERN.test(path.basename(filePath));
}

export function scriptKindForFile(filePath: string): ts.ScriptKind {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (filePath.endsWith('.mjs') || filePath.endsWith('.cjs') || filePath.endsWith('.js'))
    return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}
