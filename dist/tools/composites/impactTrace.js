import { z } from 'zod';
import { defineTool } from '../registry.js';
import { toPosition, relativePath, uriToPath } from '../../engine/positions.js';
import { DEFAULT_TIMEOUTS } from '../../engine/types.js';
export const impactTrace = defineTool({
    name: 'impact_trace',
    description: 'Follow a symbol through type aliases and re-exports to find ALL transitive usages. Returns a dependency graph with affected files ranked by distance. Answers "what breaks if I change X?" in one call.',
    schema: z.object({
        symbol: z.string().optional().describe('Symbol name. Use this OR file_path+line+column.'),
        file_path: z.string().optional().describe('Absolute file path'),
        line: z.number().optional().describe('1-indexed line number'),
        column: z.number().optional().describe('1-indexed column number'),
        max_depth: z.number().default(3).describe('Max depth to trace through aliases'),
        verbosity: z.enum(['summary', 'normal', 'detailed']).default('normal'),
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
            const prepared = await engine.prepareFile(params.file_path);
            uri = prepared.uri;
            position = toPosition(params.line, params.column);
            name = 'symbol';
        }
        else {
            return 'Error: Provide either symbol name or file_path + line + column.';
        }
        const timeout = DEFAULT_TIMEOUTS.composite;
        const visited = new Map();
        const queue = [
            { uri, position, name, depth: 0 },
        ];
        while (queue.length > 0) {
            const current = queue.shift();
            if (current.depth > params.max_depth)
                continue;
            const key = `${current.uri}:${current.position.line}:${current.position.character}`;
            if (visited.has(key))
                continue;
            // Get references for this node
            const refs = await engine.request('textDocument/references', {
                textDocument: { uri: current.uri },
                position: current.position,
                context: { includeDeclaration: false },
            }, timeout).catch(() => null);
            const refCount = refs?.length ?? 0;
            // Check if this is a type alias (has a type definition different from itself)
            let isTypeAlias = false;
            const typeDef = await engine.request('textDocument/typeDefinition', {
                textDocument: { uri: current.uri },
                position: current.position,
            }, timeout).catch(() => null);
            if (typeDef) {
                const defs = Array.isArray(typeDef) ? typeDef : [typeDef];
                for (const def of defs) {
                    const defKey = `${def.uri}:${def.range.start.line}:${def.range.start.character}`;
                    if (defKey !== key && !visited.has(defKey)) {
                        isTypeAlias = true;
                        // Enqueue the type definition target
                        queue.push({
                            uri: def.uri,
                            position: def.range.start,
                            name: current.name,
                            depth: current.depth + 1,
                        });
                    }
                }
            }
            visited.set(key, {
                uri: current.uri,
                name: current.name,
                depth: current.depth,
                refCount,
                isTypeAlias,
            });
            // Check for re-exports among references
            if (refs) {
                for (const ref of refs) {
                    const refPath = uriToPath(ref.uri);
                    const content = engine.docManager.getContent(ref.uri);
                    if (content) {
                        const line = content.split('\n')[ref.range.start.line];
                        if (line && /export\s/.test(line)) {
                            const refKey = `${ref.uri}:${ref.range.start.line}:${ref.range.start.character}`;
                            if (!visited.has(refKey)) {
                                queue.push({
                                    uri: ref.uri,
                                    position: ref.range.start,
                                    name: current.name,
                                    depth: current.depth + 1,
                                });
                            }
                        }
                    }
                }
            }
        }
        // Aggregate results
        const allRefs = new Set();
        const allFiles = new Set();
        let directCallers = 0;
        let typeAnnotations = 0;
        let transitiveRefs = 0;
        for (const node of visited.values()) {
            allRefs.add(`${node.uri}:${node.refCount}`);
            if (node.refCount > 0) {
                if (node.depth === 0)
                    directCallers += node.refCount;
                else if (node.isTypeAlias)
                    typeAnnotations += node.refCount;
                else
                    transitiveRefs += node.refCount;
            }
        }
        // Collect all unique referenced files across all depths
        const filesByDepth = new Map();
        for (const node of visited.values()) {
            const rel = relativePath(uriToPath(node.uri), engine.workspaceRoot);
            if (!filesByDepth.has(rel) || filesByDepth.get(rel) > node.depth) {
                filesByDepth.set(rel, node.depth);
            }
        }
        const totalRefs = directCallers + typeAnnotations + transitiveRefs;
        const totalFiles = filesByDepth.size;
        const lines = [`# Impact Trace: ${name}\n`];
        lines.push(`${totalRefs} total references across ${totalFiles} nodes`);
        if (directCallers > 0)
            lines.push(`- ${directCallers} direct references`);
        if (typeAnnotations > 0)
            lines.push(`- ${typeAnnotations} via type aliases`);
        if (transitiveRefs > 0)
            lines.push(`- ${transitiveRefs} transitive (re-exports)`);
        lines.push('');
        if (params.verbosity !== 'summary') {
            const sorted = [...filesByDepth.entries()].sort((a, b) => a[1] - b[1]);
            for (const [file, depth] of sorted) {
                const depthLabel = depth === 0 ? '(direct)' : `(depth ${depth})`;
                lines.push(`- ${file} ${depthLabel}`);
            }
        }
        return lines.join('\n');
    },
});
//# sourceMappingURL=impactTrace.js.map