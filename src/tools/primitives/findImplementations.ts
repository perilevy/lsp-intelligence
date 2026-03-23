import { z } from 'zod';
import { defineTool } from '../registry.js';
import { toPosition } from '../../engine/positions.js';
import { formatReferences } from '../../format/markdown.js';
import type { Location } from 'vscode-languageserver-protocol';

export const findImplementations = defineTool({
  name: 'find_implementations',
  description: 'Find concrete implementations of an interface or abstract class. Use before modifying a contract to see what code implements it.',
  schema: z.object({
    symbol: z.string().optional().describe('Symbol name. Use this OR file_path+line+column.'),
    file_path: z.string().optional().describe('Absolute file path'),
    line: z.number().optional().describe('1-indexed line number'),
    column: z.number().optional().describe('1-indexed column number'),
    verbosity: z.enum(['summary', 'normal', 'detailed']).default('normal'),
  }),
  async handler(params, engine) {
    let uri: string, position: { line: number; character: number };
    if (params.symbol) {
      const resolved = await engine.resolveSymbol(params.symbol, params.file_path);
      uri = resolved.uri; position = resolved.position;
    } else if (params.file_path && params.line && params.column) {
      const prepared = await engine.prepareFile(params.file_path);
      uri = prepared.uri; position = toPosition(params.line, params.column);
    } else {
      return 'Error: Provide either symbol name or file_path + line + column.';
    }
    const result = await engine.request<Location[] | null>('textDocument/implementation', {
      textDocument: { uri }, position,
    });
    return formatReferences(result, engine.workspaceRoot, params.verbosity as any);
  },
});
