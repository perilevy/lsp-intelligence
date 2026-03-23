import { z } from 'zod';
import * as fs from 'fs';
import { defineTool } from '../registry.js';
import { relativePath, getPackageName } from '../../engine/positions.js';
import { DEFAULT_TIMEOUTS } from '../../engine/types.js';
export const findUnusedExports = defineTool({
    name: 'find_unused_exports',
    description: 'Find exported symbols with zero cross-package importers. Identifies dead code that can safely be removed.',
    schema: z.object({
        file_path: z.string().describe('Absolute file path to check'),
    }),
    async handler(params, engine) {
        const { uri } = await engine.prepareFile(params.file_path);
        const content = fs.readFileSync(params.file_path, 'utf-8');
        const lines = content.split('\n');
        const timeout = DEFAULT_TIMEOUTS.live;
        const symbols = await engine.request('textDocument/documentSymbol', { textDocument: { uri } }, timeout);
        if (!symbols)
            return 'Could not get symbols for this file.';
        const currentPkg = getPackageName(params.file_path);
        const unused = [];
        const KINDS = { 5: 'Class', 10: 'Enum', 11: 'Interface', 12: 'Function', 13: 'Variable', 14: 'Constant' };
        const checkSymbol = async (sym) => {
            const lineText = lines[sym.range.start.line] ?? '';
            if (!lineText.includes('export'))
                return;
            const refs = await engine.request('textDocument/references', {
                textDocument: { uri },
                position: sym.selectionRange.start,
                context: { includeDeclaration: false },
            }, timeout).catch(() => null);
            if (!refs || refs.length === 0) {
                unused.push({
                    name: sym.name,
                    kind: KINDS[sym.kind] ?? 'Unknown',
                    line: sym.range.start.line + 1,
                });
                return;
            }
            // Check if all references are within the same package
            if (currentPkg) {
                const crossPkg = refs.filter((r) => {
                    const refPkg = getPackageName(r.uri);
                    return refPkg && refPkg !== currentPkg;
                });
                if (crossPkg.length === 0) {
                    unused.push({
                        name: sym.name,
                        kind: KINDS[sym.kind] ?? 'Unknown',
                        line: sym.range.start.line + 1,
                    });
                }
            }
        };
        for (const sym of symbols) {
            await checkSymbol(sym);
        }
        const rel = relativePath(params.file_path, engine.workspaceRoot);
        if (unused.length === 0)
            return `✅ ${rel} — all exports are used cross-package.`;
        const result = [`# Unused Exports: ${rel}\n\n${unused.length} exports with no cross-package importers\n`];
        for (const u of unused) {
            result.push(`- L${u.line}: **${u.name}** (${u.kind})`);
        }
        result.push('\n*These may be safe to remove or make package-private.*');
        return result.join('\n');
    },
});
//# sourceMappingURL=findUnusedExports.js.map