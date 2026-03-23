import { z } from 'zod';
import { defineTool } from '../registry.js';
import { toPosition, fromPosition, relativePath, uriToPath } from '../../engine/positions.js';
export const rename = defineTool({
    name: 'rename',
    description: 'Preview or execute a semantic rename across the codebase. Use dry_run=true (default) to see what would change before committing.',
    schema: z.object({
        symbol: z.string().optional().describe('Symbol name. Use this OR file_path+line+column.'),
        file_path: z.string().optional().describe('Absolute file path'),
        line: z.number().optional().describe('1-indexed line number'),
        column: z.number().optional().describe('1-indexed column number'),
        new_name: z.string().describe('New name for the symbol'),
        dry_run: z.boolean().default(true).describe('If true, only preview changes without applying'),
    }),
    annotations: { readOnlyHint: false },
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
        const result = await engine.request('textDocument/rename', {
            textDocument: { uri }, position, newName: params.new_name,
        });
        if (!result || !result.changes)
            return 'Rename not available for this symbol.';
        const lines = [`# Rename Preview: → ${params.new_name}\n`];
        let totalEdits = 0;
        for (const [fileUri, edits] of Object.entries(result.changes)) {
            const rel = relativePath(uriToPath(fileUri), engine.workspaceRoot);
            lines.push(`## ${rel} (${edits.length} changes)`);
            for (const edit of edits) {
                const pos = fromPosition(edit.range.start);
                lines.push(`- L${pos.line}: \`${edit.newText}\``);
                totalEdits++;
            }
            lines.push('');
        }
        const fileCount = Object.keys(result.changes).length;
        lines.unshift(`${totalEdits} changes across ${fileCount} files${params.dry_run ? ' (dry run)' : ''}\n`);
        if (params.dry_run) {
            lines.push('*This is a dry run. Set dry_run=false to apply.*');
        }
        return lines.join('\n');
    },
});
//# sourceMappingURL=rename.js.map