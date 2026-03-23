import type { Position } from 'vscode-languageserver-protocol';
import { LspError, LspErrorCode } from './types.js';

/**
 * Convert 1-indexed line/column (Claude-facing) to 0-indexed LSP Position.
 */
export function toPosition(line1: number, col1: number, content?: string): Position {
  const line = line1 - 1;
  const character = col1 - 1;
  if (line < 0 || character < 0) {
    throw new LspError(
      LspErrorCode.FILE_NOT_FOUND,
      `Invalid position: line ${line1}, column ${col1} (must be >= 1)`,
    );
  }
  return { line, character };
}

/**
 * Convert 0-indexed LSP Position to 1-indexed (Claude-facing).
 */
export function fromPosition(pos: Position): { line: number; column: number } {
  return { line: pos.line + 1, column: pos.character + 1 };
}

/**
 * Convert an absolute file path to a file:// URI.
 */
export function pathToUri(filePath: string): string {
  if (filePath.startsWith('file://')) return filePath;
  return `file://${filePath}`;
}

/**
 * Convert a file:// URI to an absolute file path.
 */
export function uriToPath(uri: string): string {
  if (uri.startsWith('file://')) return decodeURIComponent(uri.slice(7));
  return uri;
}

/**
 * Get the containing package name from a file path.
 * Works with any monorepo layout: packages/, apps/, libs/, modules/, services/
 * E.g., "/repo/packages/core/src/foo.ts" → "core"
 * E.g., "/repo/apps/web/src/foo.ts" → "web"
 */
export function getPackageName(filePath: string): string | null {
  const match = filePath.match(/\/(packages|apps|libs|modules|services)\/([^/]+)\//);
  return match ? match[2] : null;
}

/**
 * Shorten a file path relative to the workspace root.
 */
export function relativePath(filePath: string, workspaceRoot: string): string {
  const resolved = uriToPath(filePath);
  if (resolved.startsWith(workspaceRoot)) {
    return resolved.slice(workspaceRoot.length + 1);
  }
  return resolved;
}
