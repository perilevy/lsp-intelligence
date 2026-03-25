import { z } from 'zod';
import { defineTool } from '../registry.js';
import { relativePath } from '../../engine/positions.js';
import { getMergeBase } from '../../git/getMergeBase.js';
import { getChangedHunks } from '../../git/getChangedHunks.js';
import { LspError, LspErrorCode, DEFAULT_TIMEOUTS } from '../../engine/types.js';
const SYMBOL_KINDS = {
    5: 'Class', 6: 'Method', 10: 'Enum', 11: 'Interface',
    12: 'Function', 13: 'Variable', 14: 'Constant',
};
function findSymbolAtLine(symbols, line0) {
    for (const sym of symbols) {
        if (line0 >= sym.range.start.line && line0 <= sym.range.end.line) {
            if (sym.children) {
                const child = findSymbolAtLine(sym.children, line0);
                if (child)
                    return child;
            }
            return sym;
        }
    }
    return null;
}
export const semanticDiff = defineTool({
    name: 'semantic_diff',
    description: 'Analyze git diff semantically: identify changed symbols and their blast radius with risk classification. Requires git.',
    schema: z.object({
        base: z.string().optional().describe('Base ref to diff against. Defaults to merge-base with main.'),
    }),
    async handler(params, engine) {
        if (!engine.gitAvailable) {
            throw new LspError(LspErrorCode.GIT_UNAVAILABLE, 'Git is not available in this workspace.');
        }
        const timeout = DEFAULT_TIMEOUTS.composite;
        const base = getMergeBase(engine.workspaceRoot, params.base);
        const hunks = getChangedHunks(engine.workspaceRoot, base);
        if (hunks.length === 0) {
            return { base, changedSymbols: [], totalReferences: 0, stats: { hunksAnalyzed: 0, filesProcessed: 0 }, warnings: ['No TypeScript changes found'] };
        }
        const changedSymbols = [];
        const processedFiles = new Set();
        for (const hunk of hunks) {
            if (processedFiles.has(hunk.file))
                continue;
            try {
                const { uri } = await engine.prepareFile(hunk.file);
                const symbols = await engine.request('textDocument/documentSymbol', { textDocument: { uri } }, timeout);
                if (symbols) {
                    for (let line = hunk.startLine - 1; line <= hunk.endLine - 1; line++) {
                        const sym = findSymbolAtLine(symbols, line);
                        if (sym && !changedSymbols.some((s) => s.name === sym.name && s.file === relativePath(hunk.file, engine.workspaceRoot))) {
                            const refs = await engine.request('textDocument/references', {
                                textDocument: { uri },
                                position: sym.selectionRange.start,
                                context: { includeDeclaration: false },
                            }, timeout).catch(() => null);
                            const refCount = refs?.length ?? 0;
                            changedSymbols.push({
                                name: sym.name,
                                kind: SYMBOL_KINDS[sym.kind] ?? 'Unknown',
                                file: relativePath(hunk.file, engine.workspaceRoot),
                                refCount,
                                risk: refCount > 10 ? 'high' : refCount > 3 ? 'medium' : 'low',
                            });
                        }
                    }
                }
            }
            catch { }
            processedFiles.add(hunk.file);
        }
        const totalReferences = changedSymbols.reduce((s, c) => s + c.refCount, 0);
        return {
            base,
            changedSymbols: changedSymbols.sort((a, b) => b.refCount - a.refCount),
            totalReferences,
            stats: { hunksAnalyzed: hunks.length, filesProcessed: processedFiles.size },
            warnings: [],
        };
    },
});
//# sourceMappingURL=semanticDiff.js.map