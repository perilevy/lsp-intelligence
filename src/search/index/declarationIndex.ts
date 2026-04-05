import { parseSourceFile } from '../../analysis/ts/parseSourceFile.js';
import { extractDeclarations } from '../../analysis/ts/extractDeclarations.js';
import type { DeclarationIndexEntry } from '../types.js';

/**
 * Build declaration index entries for a single file.
 * Uses TypeScript compiler AST, not regex.
 *
 * @param text - Optional overlay text for unsaved-buffer support (Phase 2A).
 */
export function indexFileDeclarations(filePath: string, text?: string): DeclarationIndexEntry[] {
  const sf = parseSourceFile(filePath, text);
  if (!sf) return [];
  return extractDeclarations(sf);
}
