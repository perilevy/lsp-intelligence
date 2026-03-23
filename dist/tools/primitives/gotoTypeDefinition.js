import { z } from 'zod';
import { defineTool } from '../registry.js';
import { toPosition } from '../../engine/positions.js';
import { formatDefinitions } from '../../format/markdown.js';
export const gotoTypeDefinition = defineTool({
    name: 'goto_type_definition',
    description: 'Find the type that defines a variable or parameter. Use when you have a variable and want its interface/class definition, not where the variable is declared.',
    schema: z.object({
        symbol: z.string().optional().describe('Symbol name. Use this OR file_path+line+column.'),
        file_path: z.string().optional().describe('Absolute file path'),
        line: z.number().optional().describe('1-indexed line number'),
        column: z.number().optional().describe('1-indexed column number'),
    }),
    async handler(params, engine) {
        let uri, position;
        if (params.symbol) {
            const resolved = await engine.resolveSymbol(params.symbol, params.file_path);
            uri = resolved.uri;
            position = resolved.position;
        }
        else if (params.file_path && params.line && params.column) {
            const prepared = await engine.prepareFile(params.file_path);
            uri = prepared.uri;
            position = toPosition(params.line, params.column);
        }
        else {
            return 'Error: Provide either symbol name or file_path + line + column.';
        }
        const result = await engine.request('textDocument/typeDefinition', {
            textDocument: { uri }, position,
        });
        return formatDefinitions(result, engine.workspaceRoot);
    },
});
//# sourceMappingURL=gotoTypeDefinition.js.map