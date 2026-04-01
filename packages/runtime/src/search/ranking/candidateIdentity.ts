import * as path from 'path';

/**
 * Canonical candidate identity key.
 * Used consistently across merge, coalesce, graph expansion, and ranking.
 *
 * Format: filePath:line1based:symbol
 * Both functions produce the same format so keys match across subsystems.
 */
export function absoluteCandidateKey(input: {
  filePath: string;
  line: number;
  symbol?: string;
  matchedIdentifier?: string;
}): string {
  const symbol = input.symbol ?? input.matchedIdentifier ?? '';
  return `${input.filePath}:${input.line}:${symbol}`;
}

/**
 * Convert an LSP URI + 0-based position to the candidate key format.
 * Used by graph expansion to generate keys that match candidate keys.
 *
 * Produces workspace-relative paths to match candidates after ranking
 * (which relativizes paths via relativePath()).
 */
export function lspLocationToKey(
  uri: string,
  line0: number,
  workspaceRoot: string,
  symbol?: string,
): string {
  let absPath = uri;
  if (uri.startsWith('file://')) {
    absPath = decodeURIComponent(uri.replace(/^file:\/\//, ''));
  }

  const rel = path.relative(workspaceRoot, absPath);
  const line1 = line0 + 1;
  return `${rel}:${line1}:${symbol ?? ''}`;
}