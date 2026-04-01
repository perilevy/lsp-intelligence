import { z } from 'zod';
import { defineTool } from '../registry.js';
import { toPosition } from '../../engine/positions.js';
import { formatHover } from '../../format/markdown.js';
import type { Hover } from 'vscode-languageserver-protocol';

export const hover = defineTool({
  name: 'hover',
  description:
    'Get the full type signature and documentation for a symbol. Accepts symbol name OR file position. Returns the same info you see when hovering in VS Code.',
  schema: z.object({
    symbol: z.string().optional().describe('Symbol name, e.g. "IssuesSDK". Use this OR file_path+line+column.'),
    file_path: z.string().optional().describe('Absolute file path. Required with line+column.'),
    line: z.number().optional().describe('1-indexed line number'),
    column: z.number().optional().describe('1-indexed column number'),
  }),
  async handler(params, engine) {
    let uri: string;
    let position: { line: number; character: number };

    if (params.symbol) {
      const resolved = await engine.resolveSymbol(params.symbol, params.file_path);
      uri = resolved.uri;
      position = resolved.position;
    } else if (params.file_path && params.line && params.column) {
      const prepared = await engine.prepareFile(params.file_path);
      uri = prepared.uri;
      position = toPosition(params.line, params.column);
    } else {
      return 'Error: Provide either symbol name or file_path + line + column.';
    }

    const result = await engine.request<Hover | null>('textDocument/hover', {
      textDocument: { uri },
      position,
    });

    return formatHover(result);
  },
});
