import * as fs from 'fs';
import { parse, Lang, type SgNode } from '@ast-grep/napi';

const LANG_MAP: Record<string, Lang> = {
  '.ts': Lang.TypeScript,
  '.tsx': Lang.Tsx,
  '.js': Lang.JavaScript,
  '.jsx': Lang.Tsx, // ast-grep uses Tsx for JSX
  '.mjs': Lang.JavaScript,
  '.cjs': Lang.JavaScript,
};

/**
 * Parse a source file into an ast-grep root node.
 * Supports TS, TSX, JS, JSX, MJS, CJS.
 */
export function parseFile(filePath: string): SgNode | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const ext = filePath.match(/\.[^.]+$/)?.[0] ?? '.ts';
    const lang = LANG_MAP[ext] ?? Lang.TypeScript;
    return parse(lang, content).root();
  } catch {
    return null;
  }
}

/**
 * Parse source content directly.
 * Pass the file path or extension to determine the correct language.
 */
export function parseSource(content: string, filePathOrTsx: string | boolean = false): SgNode | null {
  try {
    let lang: Lang;
    if (typeof filePathOrTsx === 'string') {
      const ext = filePathOrTsx.match(/\.[^.]+$/)?.[0] ?? '.ts';
      lang = LANG_MAP[ext] ?? Lang.TypeScript;
    } else {
      lang = filePathOrTsx ? Lang.Tsx : Lang.TypeScript;
    }
    return parse(lang, content).root();
  } catch {
    return null;
  }
}