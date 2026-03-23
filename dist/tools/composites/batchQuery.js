import { z } from 'zod';
import { defineTool } from '../registry.js';
import { formatHover } from '../../format/markdown.js';
import { DEFAULT_TIMEOUTS } from '../../engine/types.js';
export const batchQuery = defineTool({
    name: 'batch_query',
    description: 'Look up multiple symbols in one call. Returns hover + reference count for each. Saves multiple round-trips when exploring a file.',
    schema: z.object({
        symbols: z.array(z.string()).describe('List of symbol names to look up'),
        include_references: z.boolean().default(true).describe('Include reference counts'),
    }),
    async handler(params, engine) {
        const timeout = DEFAULT_TIMEOUTS.composite;
        const results = [`# Batch Query: ${params.symbols.length} symbols\n`];
        for (const symbol of params.symbols) {
            try {
                const resolved = await engine.resolveSymbol(symbol);
                const uri = resolved.uri;
                const position = resolved.position;
                const hover = await engine.request('textDocument/hover', { textDocument: { uri }, position }, timeout).catch(() => null);
                let refCount = 0;
                if (params.include_references) {
                    const refs = await engine.request('textDocument/references', {
                        textDocument: { uri }, position, context: { includeDeclaration: false },
                    }, timeout).catch(() => null);
                    refCount = refs?.length ?? 0;
                }
                const hoverText = formatHover(hover);
                const sig = hoverText.length > 200 ? hoverText.substring(0, 200) + '...' : hoverText;
                results.push(`## ${symbol}${refCount > 0 ? ` (${refCount} refs)` : ''}\n\n${sig}\n`);
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                results.push(`## ${symbol}\n\n*Error: ${msg}*\n`);
            }
        }
        return results.join('\n');
    },
});
//# sourceMappingURL=batchQuery.js.map