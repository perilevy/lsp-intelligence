import * as fs from 'fs';
import { parse, Lang } from '@ast-grep/napi';
import type { SearchScope, PatternMatch } from '../../search/types.js';
import { collectSearchFiles } from './collectSearchFiles.js';
import { relativePath } from '../../engine/positions.js';

const LANG_MAP: Record<string, Lang> = {
  typescript: Lang.TypeScript,
  tsx: Lang.Tsx,
  javascript: Lang.JavaScript,
};

const EXT_MAP: Record<string, string[]> = {
  typescript: ['.ts', '.mjs', '.cjs'],
  tsx: ['.tsx', '.ts'],
  javascript: ['.js', '.jsx', '.mjs', '.cjs'],
};

/**
 * Run an ast-grep pattern search across files in scope.
 * This is the engine behind find_pattern. Structural retrievers may also use it.
 */
export function runPatternSearch(input: {
  pattern: string;
  language: 'typescript' | 'tsx' | 'javascript';
  scope: SearchScope;
  maxResults: number;
  contextLines: number;
  workspaceRoot: string;
}): {
  filesScanned: number;
  matches: PatternMatch[];
  warnings: string[];
} {
  const lang = LANG_MAP[input.language];
  if (!lang) return { filesScanned: 0, matches: [], warnings: [`Unsupported language: ${input.language}`] };

  const extensions = EXT_MAP[input.language];
  const files = collectSearchFiles(input.scope, extensions, 500);
  const matches: PatternMatch[] = [];
  const warnings: string[] = [];

  for (const file of files) {
    if (matches.length >= input.maxResults) break;
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const root = parse(lang, content).root();
      const found = root.findAll(input.pattern);

      for (const match of found) {
        if (matches.length >= input.maxResults) break;
        const range = match.range();
        const line = range.start.line + 1;
        matches.push({
          filePath: relativePath(file, input.workspaceRoot),
          line,
          column: range.start.column,
          text: match.text().substring(0, 200),
          context: getContextLines(content, range.start.line, input.contextLines),
        });
      }
    } catch (err) {
      warnings.push(`Parse failed for ${relativePath(file, input.workspaceRoot)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { filesScanned: files.length, matches, warnings };
}

function getContextLines(content: string, line0: number, ctx: number): string {
  const lines = content.split('\n');
  const start = Math.max(0, line0 - ctx);
  const end = Math.min(lines.length - 1, line0 + ctx);
  return lines
    .slice(start, end + 1)
    .map((l, i) => `${start + i + 1}| ${l}`)
    .join('\n');
}
