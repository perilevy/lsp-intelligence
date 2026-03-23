import { z } from 'zod';
import { defineTool } from '../registry.js';
import { relativePath, uriToPath } from '../../engine/positions.js';
import { DEFAULT_TIMEOUTS } from '../../engine/types.js';
const TEST_PATTERNS = /\.(spec|test|stories)\.(ts|tsx|js|jsx)$/;
export const findTestFiles = defineTool({
    name: 'find_test_files',
    description: 'Find all test files (spec, test, stories) that reference a symbol. Use before modifying code to know which tests to update.',
    schema: z.object({
        symbol: z.string().optional().describe('Symbol name. Use this OR file_path+line+column.'),
        file_path: z.string().optional().describe('Absolute file path'),
        line: z.number().optional().describe('1-indexed line number'),
        column: z.number().optional().describe('1-indexed column number'),
    }),
    async handler(params, engine) {
        let uri, position, name;
        if (params.symbol) {
            const resolved = await engine.resolveSymbol(params.symbol, params.file_path);
            uri = resolved.uri;
            position = resolved.position;
            name = resolved.name ?? params.symbol;
        }
        else if (params.file_path && params.line && params.column) {
            const { toPosition } = await import('../../engine/positions.js');
            const prepared = await engine.prepareFile(params.file_path);
            uri = prepared.uri;
            position = toPosition(params.line, params.column);
            name = 'symbol';
        }
        else {
            return 'Error: Provide either symbol name or file_path + line + column.';
        }
        const refs = await engine.request('textDocument/references', {
            textDocument: { uri }, position, context: { includeDeclaration: false },
        }, DEFAULT_TIMEOUTS.composite);
        if (!refs || refs.length === 0)
            return `No references found for ${name}.`;
        // Filter to test files
        const testRefs = refs.filter((r) => TEST_PATTERNS.test(uriToPath(r.uri)));
        if (testRefs.length === 0)
            return `No test files reference ${name}. Consider adding tests.`;
        // Group by file
        const byFile = new Map();
        for (const ref of testRefs) {
            const file = uriToPath(ref.uri);
            byFile.set(file, (byFile.get(file) ?? 0) + 1);
        }
        const lines = [`# Test Files for ${name}\n\n${byFile.size} test files, ${testRefs.length} references\n`];
        for (const [file, count] of [...byFile.entries()].sort()) {
            const rel = relativePath(file, engine.workspaceRoot);
            const type = file.includes('.stories.') ? 'story' : file.includes('.spec.') ? 'spec' : 'test';
            lines.push(`- **${rel}** (${count} refs, ${type})`);
        }
        return lines.join('\n');
    },
});
//# sourceMappingURL=findTestFiles.js.map