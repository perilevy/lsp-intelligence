import { LspError, LspErrorCode } from './types.js';
/**
 * Convert 1-indexed line/column (Claude-facing) to 0-indexed LSP Position.
 */
export function toPosition(line1, col1, content) {
    const line = line1 - 1;
    const character = col1 - 1;
    if (line < 0 || character < 0) {
        throw new LspError(LspErrorCode.FILE_NOT_FOUND, `Invalid position: line ${line1}, column ${col1} (must be >= 1)`);
    }
    return { line, character };
}
/**
 * Convert 0-indexed LSP Position to 1-indexed (Claude-facing).
 */
export function fromPosition(pos) {
    return { line: pos.line + 1, column: pos.character + 1 };
}
/**
 * Convert an absolute file path to a file:// URI.
 */
export function pathToUri(filePath) {
    if (filePath.startsWith('file://'))
        return filePath;
    return `file://${filePath}`;
}
/**
 * Convert a file:// URI to an absolute file path.
 */
export function uriToPath(uri) {
    if (uri.startsWith('file://'))
        return decodeURIComponent(uri.slice(7));
    return uri;
}
/**
 * Get the containing package name from a file path.
 * Works with any monorepo layout: packages/, apps/, libs/, modules/, services/
 * E.g., "/repo/packages/core/src/foo.ts" → "core"
 * E.g., "/repo/apps/web/src/foo.ts" → "web"
 */
export function getPackageName(filePath) {
    const match = filePath.match(/\/(packages|apps|libs|modules|services)\/([^/]+)\//);
    return match ? match[2] : null;
}
/**
 * Shorten a file path relative to the workspace root.
 */
export function relativePath(filePath, workspaceRoot) {
    const resolved = uriToPath(filePath);
    if (resolved.startsWith(workspaceRoot)) {
        return resolved.slice(workspaceRoot.length + 1);
    }
    return resolved;
}
//# sourceMappingURL=positions.js.map