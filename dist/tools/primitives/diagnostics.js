import { z } from 'zod';
import { defineTool } from '../registry.js';
import { relativePath, fromPosition } from '../../engine/positions.js';
const SEVERITY = { 1: 'Error', 2: 'Warning', 3: 'Info', 4: 'Hint' };
export const diagnostics = defineTool({
    name: 'diagnostics',
    description: 'Get type errors and warnings for a file. Diagnostics are pushed by TypeScript Server in real-time.',
    schema: z.object({
        file_path: z.string().describe('Absolute file path'),
    }),
    async handler(params, engine) {
        const { uri } = await engine.prepareFile(params.file_path);
        // Wait briefly for diagnostics to be pushed
        await new Promise((r) => setTimeout(r, 500));
        const diags = engine.docManager.getCachedDiagnostics(uri);
        if (diags.length === 0) {
            const rel = relativePath(params.file_path, engine.workspaceRoot);
            return `No diagnostics for ${rel}. File is clean.`;
        }
        const rel = relativePath(params.file_path, engine.workspaceRoot);
        const lines = [`# Diagnostics: ${rel}\n\n${diags.length} issues\n`];
        for (const d of diags.sort((a, b) => a.range.start.line - b.range.start.line)) {
            const severity = SEVERITY[d.severity ?? 1];
            const pos = fromPosition(d.range.start);
            lines.push(`- **${severity}** L${pos.line}: ${d.message}`);
            if (d.code)
                lines[lines.length - 1] += ` (TS${d.code})`;
        }
        return lines.join('\n');
    },
});
//# sourceMappingURL=diagnostics.js.map