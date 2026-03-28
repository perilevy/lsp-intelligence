import * as path from 'path';

/**
 * Canonical absolute candidate identity.
 * Used consistently across merge, coalesce, graph expansion, and ranking.
 *
 * Format: absoluteFilePath:line1based:symbol
 * This is the ONLY key format used for candidate matching.
 */
export function absoluteCandidateKey(input: {
  filePath: string;
  line: number;
  symbol?: string;
  matchedIdentifier?: string;
}): string {
  // Normalize to absolute path if not already
  const absPath = path.isAbsolute(input.filePath) ? input.filePath : input.filePath;
  const symbol = input.symbol ?? input.matchedIdentifier ?? '';
  return `${absPath}:${input.line}:${symbol}`;
}

/**
 * Convert an LSP URI + 0-based position to the candidate key format.
 * Used by graph expansion to generate keys that match candidate keys.
 */
export function lspLocationToKey(
  uri: string,
  line0: number,
  workspaceRoot: string,
  symbol?: string,
): string {
  // Convert file:// URI to absolute path
  let absPath = uri;
  if (uri.startsWith('file://')) {
    absPath = decodeURIComponent(uri.replace(/^file:\/\//, ''));
  }

  // Make relative to workspace for consistency with post-ranking paths
  const rel = path.relative(workspaceRoot, absPath);
  const line1 = line0 + 1;
  return `${rel}:${line1}:${symbol ?? ''}`;
}
