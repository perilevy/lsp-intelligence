import type { Position } from 'vscode-languageserver-protocol';
/**
 * Convert 1-indexed line/column (Claude-facing) to 0-indexed LSP Position.
 */
export declare function toPosition(line1: number, col1: number, content?: string): Position;
/**
 * Convert 0-indexed LSP Position to 1-indexed (Claude-facing).
 */
export declare function fromPosition(pos: Position): {
    line: number;
    column: number;
};
/**
 * Convert an absolute file path to a file:// URI.
 */
export declare function pathToUri(filePath: string): string;
/**
 * Convert a file:// URI to an absolute file path.
 */
export declare function uriToPath(uri: string): string;
/**
 * Get the containing package name from a file path.
 * Works with any monorepo layout: packages/, apps/, libs/, modules/, services/
 * E.g., "/repo/packages/core/src/foo.ts" → "core"
 * E.g., "/repo/apps/web/src/foo.ts" → "web"
 */
export declare function getPackageName(filePath: string): string | null;
/**
 * Shorten a file path relative to the workspace root.
 */
export declare function relativePath(filePath: string, workspaceRoot: string): string;
