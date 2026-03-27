import * as path from 'path';
import ts from 'typescript';

export const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] as const;
export const CONFIG_EXTENSIONS = ['.json', '.yaml', '.yml', '.env', '.toml'] as const;

const TEST_PATTERN = /\.(spec|test|stories)\.(ts|tsx|js|jsx|mjs|cjs)$/;

export function isCodeFile(filePath: string): boolean {
  if (filePath.endsWith('.d.ts')) return false;
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
