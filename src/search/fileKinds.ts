import * as path from 'path';
import ts from 'typescript';

export const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] as const;
export const CONFIG_EXTENSIONS = ['.json', '.yaml', '.yml', '.env', '.toml'] as const;

const TEST_PATTERN = /\.(spec|test|stories)\.(ts|tsx|js|jsx|mjs|cjs)$/;

// --- Directory exclusion ---

/** Directories skipped by name (exact match against basename). */
const SKIP_DIR_NAMES = new Set([
  'node_modules', 'dist', 'build', 'es', 'coverage',
  '__pycache__', '__generated__', '__mocks__',
]);

/**
 * Should this directory be skipped during file discovery?
 * Matches: dot-prefixed dirs (.*), hardcoded names, and build output.
 */
export function shouldSkipDir(dirName: string): boolean {
  // Dot-prefixed: .yarn, .git, .cache, .vscode, .idea, .next, .turbo, etc.
  if (dirName.startsWith('.')) return true;
  return SKIP_DIR_NAMES.has(dirName);
}

// --- File exclusion ---

/** Patterns for files that should never be indexed. */
const SKIP_FILE_PATTERNS = [
  /\.min\.(js|cjs|mjs)$/,     // Minified
  /\.bundle\.(js|cjs|mjs)$/,  // Bundled
  /\.map$/,                    // Source maps
  /\.lock$/,                   // Lock files (yarn.lock, pnpm-lock, etc.)
  /-lock\.json$/,              // package-lock.json, npm-shrinkwrap
];

/** Maximum file size to index (bytes). Avoids 5MB vendored bundles. */
const MAX_FILE_SIZE = 500_000; // 500 KB

/**
 * Should this file be skipped during discovery?
 * Checks extension patterns, size (if stat provided), and declaration files.
 */
export function shouldSkipFile(filePath: string, sizeBytes?: number): boolean {
  const basename = path.basename(filePath);

  // Declaration files
  if (basename.endsWith('.d.ts')) return true;

  // Pattern-based exclusion
  if (SKIP_FILE_PATTERNS.some((p) => p.test(basename))) return true;

  // Size guard
  if (sizeBytes !== undefined && sizeBytes > MAX_FILE_SIZE) return true;

  return false;
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

/**
 * Map a file extension to the ts.ScriptKind the TypeScript compiler needs.
 * JS/MJS/CJS are parsed as JS; JSX as JSX; TS as TS; TSX as TSX.
 */
export function scriptKindForFile(filePath: string): ts.ScriptKind {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (filePath.endsWith('.mjs') || filePath.endsWith('.cjs') || filePath.endsWith('.js'))
    return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}
