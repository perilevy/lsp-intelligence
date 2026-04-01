import { parseSourceFile } from '../../analysis/ts/parseSourceFile.js';
import { extractDeclarations } from '../../analysis/ts/extractDeclarations.js';
import type { DeclarationIndexEntry } from '../types.js';

/**
 * Build declaration index entries for a single file.
 * Uses TypeScript compiler AST, not regex.
 */
export function indexFileDeclarations(filePath: string): DeclarationIndexEntry[] {
  const sf = parseSourceFile(filePath);
  if (!sf) return [];
  return extractDeclarations(sf);
}
