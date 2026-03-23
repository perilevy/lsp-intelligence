import { z } from 'zod';
import { defineTool } from '../registry.js';
import { toPosition } from '../../engine/positions.js';
import type { CompletionList, CompletionItem } from 'vscode-languageserver-protocol';

export const completions = defineTool({
  name: 'completions',
  description: 'Get code completion suggestions at a position. Rarely needed by agents — prefer hover or auto_import instead.',
  schema: z.object({
    file_path: z.string().describe('Absolute file path'),
    line: z.number().describe('1-indexed line number'),
    column: z.number().describe('1-indexed column number'),
    limit: z.number().default(20).describe('Max results'),
  }),
  async handler(params, engine) {
    const { uri } = await engine.prepareFile(params.file_path);
    const position = toPosition(params.line, params.column);
    const result = await engine.request<CompletionList | CompletionItem[] | null>('textDocument/completion', {
      textDocument: { uri }, position,
    });

    const items: CompletionItem[] = Array.isArray(result) ? result : result?.items ?? [];
    if (items.length === 0) return 'No completions available.';

    const limited = items.slice(0, params.limit);
    const lines = [`# Completions (${limited.length}/${items.length})\n`];
    for (const item of limited) {
      const detail = item.detail ? ` — ${item.detail}` : '';
      lines.push(`- \`${item.label}\`${detail}`);
    }
    return lines.join('\n');
  },
});
