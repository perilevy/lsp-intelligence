import { z } from 'zod';
import { defineTool } from '../registry.js';
import { toPosition, fromPosition, relativePath, uriToPath } from '../../engine/positions.js';
export const typeHierarchy = defineTool({
    name: 'type_hierarchy',
    description: 'Explore inheritance relationships — supertypes and subtypes. Use to understand class/interface hierarchies.',
    schema: z.object({
        symbol: z.string().optional().describe('Symbol name. Use this OR file_path+line+column.'),
        file_path: z.string().optional().describe('Absolute file path'),
        line: z.number().optional().describe('1-indexed line number'),
        column: z.number().optional().describe('1-indexed column number'),
        direction: z.enum(['supertypes', 'subtypes']).default('supertypes'),
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
        let items;
        try {
            items = await engine.request('textDocument/prepareTypeHierarchy', { textDocument: { uri }, position });
        }
        catch {
            return 'Type hierarchy is not supported by the current language server.';
        }
        if (!items || items.length === 0)
            return 'No type hierarchy available for this symbol.';
        const item = items[0];
        const method = params.direction === 'supertypes'
            ? 'typeHierarchy/supertypes' : 'typeHierarchy/subtypes';
        const related = await engine.request(method, { item });
        if (!related || related.length === 0) {
            return `No ${params.direction} found for ${item.name}.`;
        }
        const label = params.direction === 'supertypes' ? 'Supertypes' : 'Subtypes';
        const lines = [`# ${label} of ${item.name}\n\n${related.length} types\n`];
        for (const t of related) {
            const rel = relativePath(uriToPath(t.uri), engine.workspaceRoot);
            const pos = fromPosition(t.selectionRange.start);
            lines.push(`- **${t.name}** — ${rel}:${pos.line}`);
        }
        return lines.join('\n');
    },
});
//# sourceMappingURL=typeHierarchy.js.map