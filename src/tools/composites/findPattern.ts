import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { parse, Lang } from '@ast-grep/napi';
import { defineTool } from '../registry.js';
import { relativePath } from '../../engine/positions.js';
import { SKIP_DIRS } from '../../engine/types.js';

const LANG_MAP: Record<string, Lang> = {
  typescript: Lang.TypeScript,
  tsx: Lang.Tsx,
  javascript: Lang.JavaScript,
};

function collectFiles(dir: string, ext: string[], maxFiles: number): string[] {
  const files: string[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 6 || files.length >= maxFiles) return;
    try {
      for (const entry of fs.readdirSync(d)) {
        if (SKIP_DIRS.has(entry)) continue;
        const full = path.join(d, entry);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) walk(full, depth + 1);
        else if (ext.some((e) => entry.endsWith(e))) files.push(full);
      }
    } catch {}
  };
  walk(dir, 0);
  return files;
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

export const findPattern = defineTool({
  name: 'find_pattern',
  description:
    'Search for AST structural patterns across the codebase using ast-grep. Use $VAR for single node, $$$ for multiple nodes. Example: "useEffect($$$)" finds all useEffect calls.',
  schema: z.object({
    pattern: z.string().describe('ast-grep pattern. Use $VAR for single node, $$$ for any sequence.'),
    language: z.enum(['typescript', 'tsx', 'javascript']).default('typescript'),
    paths: z.array(z.string()).optional().describe('Limit search to specific directories (absolute paths)'),
    max_results: z.number().default(50),
  }),
  async handler(params, engine) {
    const lang = LANG_MAP[params.language];
    if (!lang) return `Error: Unsupported language "${params.language}"`;

    const extMap: Record<string, string[]> = {
      typescript: ['.ts'],
      tsx: ['.tsx', '.ts'],
      javascript: ['.js'],
      jsx: ['.jsx', '.js'],
    };
    const extensions = extMap[params.language];

    const searchDirs = params.paths ?? [engine.workspaceRoot];
    const allFiles: string[] = [];
    for (const dir of searchDirs) {
      allFiles.push(...collectFiles(dir, extensions, 500));
    }

    const results: { file: string; line: number; text: string; context: string }[] = [];

    for (const file of allFiles) {
      if (results.length >= params.max_results) break;
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const root = parse(lang, content).root();
        const matches = root.findAll(params.pattern);
        for (const match of matches) {
          if (results.length >= params.max_results) break;
          const range = match.range();
          results.push({
            file,
            line: range.start.line + 1,
            text: match.text().substring(0, 200),
            context: getContextLines(content, range.start.line, 1),
          });
        }
      } catch {}
    }

    if (results.length === 0) return `No matches for pattern: \`${params.pattern}\``;

    const lines = [`# Pattern Search: \`${params.pattern}\`\n\n${results.length} matches in ${allFiles.length} files scanned\n`];
    for (const r of results) {
      const rel = relativePath(r.file, engine.workspaceRoot);
      lines.push(`## ${rel}:${r.line}\n\`\`\`\n${r.context}\n\`\`\`\n`);
    }

    return lines.join('\n');
  },
});
