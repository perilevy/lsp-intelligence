import * as fs from 'fs';
import { parse, Lang, type SgNode } from '@ast-grep/napi';

/**
 * Parse a TypeScript/TSX file into an ast-grep root node.
 * Returns null if parsing fails.
 */
export function parseFile(filePath: string): SgNode | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lang = filePath.endsWith('.tsx') ? Lang.Tsx : Lang.TypeScript;
    return parse(lang, content).root();
  } catch {
    return null;
  }
}

/**
 * Parse source content directly.
 */
export function parseSource(content: string, isTsx = false): SgNode | null {
  try {
    const lang = isTsx ? Lang.Tsx : Lang.TypeScript;
    return parse(lang, content).root();
  } catch {
    return null;
  }
}
