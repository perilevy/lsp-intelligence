import * as fs from 'fs';
import * as path from 'path';
import { SKIP_DIRS } from '../engine/types.js';
import type { LexicalEntry } from './types.js';

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
  'under', 'again', 'further', 'then', 'once', 'where', 'how', 'what',
  'which', 'who', 'when', 'why', 'all', 'each', 'every', 'both', 'few',
  'more', 'most', 'other', 'some', 'such', 'no', 'not', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 'just', 'because', 'but', 'and',
  'or', 'if', 'while', 'about', 'up', 'it', 'its', 'we', 'they', 'i',
  'my', 'our', 'this', 'that', 'these', 'those', 'me', 'him', 'her',
]);

/**
 * Tokenize a symbol name: split camelCase, PascalCase, snake_case, kebab-case.
 * Returns lowercase tokens with stop words removed.
 */
export function tokenize(name: string): string[] {
  return name
    // Split camelCase/PascalCase: insertSpace before uppercase letter preceded by lowercase
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    // Split on non-alphanumeric
    .split(/[^a-zA-Z0-9]+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/**
 * Build a lightweight lexical index from workspace files.
 * Scans .ts/.tsx files, extracts exported symbols and file metadata.
 */
export function buildLexicalIndex(workspaceRoot: string): LexicalEntry[] {
  const entries: LexicalEntry[] = [];
  const extensions = ['.ts', '.tsx'];

  const walk = (dir: string, depth: number) => {
    if (depth > 8 || entries.length > 10000) return;
    try {
      for (const entry of fs.readdirSync(dir)) {
        if (SKIP_DIRS.has(entry)) continue;
        const full = path.join(dir, entry);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          walk(full, depth + 1);
        } else if (extensions.some((e) => entry.endsWith(e))) {
          extractFileEntries(full, entries);
        }
      }
    } catch {}
  };

  walk(workspaceRoot, 0);
  return entries;
}

function extractFileEntries(filePath: string, entries: LexicalEntry[]): void {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Match exported declarations
      const exportMatch = line.match(
        /export\s+(?:default\s+)?(?:const|let|var|function|class|interface|type|enum|abstract\s+class)\s+(\w+)/,
      );
      if (exportMatch) {
        const name = exportMatch[1];
        const kind = detectKind(line);
        entries.push({
          symbol: name,
          kind,
          filePath,
          line: i + 1,
          tokens: tokenize(name),
          isExported: true,
        });
        continue;
      }

      // Match non-exported top-level declarations (function/class only — skip variables)
      if (i > 0 && !line.startsWith(' ') && !line.startsWith('\t')) {
        const declMatch = line.match(
          /^(?:const|function|class|interface|type|enum)\s+(\w+)/,
        );
        if (declMatch) {
          const name = declMatch[1];
          entries.push({
            symbol: name,
            kind: detectKind(line),
            filePath,
            line: i + 1,
            tokens: tokenize(name),
            isExported: false,
          });
        }
      }
    }

    // Also index the file itself by name
    const basename = path.basename(filePath, path.extname(filePath));
    entries.push({
      symbol: basename,
      kind: 'file',
      filePath,
      line: 1,
      tokens: tokenize(basename),
      isExported: false,
    });
  } catch {}
}

function detectKind(line: string): string {
  if (line.includes('function')) return 'function';
  if (line.includes('class')) return 'class';
  if (line.includes('interface')) return 'interface';
  if (line.includes('type ')) return 'type';
  if (line.includes('enum')) return 'enum';
  if (line.includes('const') || line.includes('let')) return 'variable';
  return 'unknown';
}
