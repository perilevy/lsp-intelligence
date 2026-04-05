import { parseSourceFile } from '../../analysis/ts/parseSourceFile.js';
import { extractUsages } from '../../analysis/ts/extractUsages.js';
import type { UsageIndexEntry } from '../types.js';

/**
 * Build usage index entries for a single file.
 * Indexes call expressions, member calls, imports, JSX tags using TS compiler AST.
 *
 * @param text - Optional overlay text for unsaved-buffer support (Phase 2A).
 */
export function indexFileUsages(filePath: string, text?: string): UsageIndexEntry[] {
  const sf = parseSourceFile(filePath, text);
  if (!sf) return [];
  return extractUsages(sf);
}
