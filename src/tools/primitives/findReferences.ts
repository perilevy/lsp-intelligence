import { z } from 'zod';
import { defineTool } from '../registry.js';
import { toPosition } from '../../engine/positions.js';
import { formatReferences } from '../../format/markdown.js';
import type { Verbosity } from '../../engine/types.js';
import type { Location } from 'vscode-languageserver-protocol';

export const findReferences = defineTool({
  name: 'find_references',
  description:
    'Find every usage of a symbol across the codebase. Accepts symbol name OR file position. Semantic — no false positives from comments or strings. More accurate than grep.',
  schema: z.object({
    symbol: z.string().optional().describe('Symbol name, e.g. "createSDK". Use this OR file_path+line+column.'),
    file_path: z.string().optional().describe('Absolute file path. Required with line+column.'),
    line: z.number().optional().describe('1-indexed line number'),
    column: z.number().optional().describe('1-indexed column number'),
    include_declaration: z.boolean().default(true).describe('Include the declaration itself in results'),
    limit: z.number().default(100).describe('Maximum number of results'),
    verbosity: z.enum(['summary', 'normal', 'detailed']).default('normal').describe('Output detail level'),
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

    const result = await engine.request<Location[] | null>('textDocument/references', {
      textDocument: { uri },
      position,
      context: { includeDeclaration: params.include_declaration },
    });

    const limited = result?.slice(0, params.limit) ?? [];
    return formatReferences(limited, engine.workspaceRoot, params.verbosity as Verbosity);
  },
});
