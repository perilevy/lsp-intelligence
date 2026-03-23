import { z } from 'zod';
import * as fs from 'fs';
import { defineTool } from '../registry.js';
import { relativePath, uriToPath } from '../../engine/positions.js';
import { formatHover } from '../../format/markdown.js';
import { DEFAULT_TIMEOUTS } from '../../engine/types.js';
function estimateTokens(text) {
    return Math.ceil(text.length / 3.0);
}
function extractSymbolBody(content, startLine, endLine) {
    const lines = content.split('\n');
    return lines.slice(startLine, endLine + 1).map((l, i) => `${startLine + i + 1}| ${l}`).join('\n');
}
export const gatherContext = defineTool({
    name: 'gather_context',
    description: 'Build minimal, complete context for a task. Given entry symbols, traces the impact graph, extracts only relevant code, and returns a token-budgeted context with must-modify / verify-only / skip classification.',
    schema: z.object({
        symbols: z.array(z.string()).describe('Entry point symbol names'),
        max_tokens: z.number().default(100000).describe('Token budget for the output. Default is generous — the agent should adjust based on remaining context window.'),
        depth: z.number().default(2).describe('How many levels of references to follow'),
    }),
    async handler(params, engine) {
        const timeout = DEFAULT_TIMEOUTS.context;
        const nodes = [];
        let tokensUsed = 0;
        // Phase 1: Resolve entry points
        const entries = [];
        for (const sym of params.symbols) {
            try {
                const resolved = await engine.resolveSymbol(sym);
                entries.push({ uri: resolved.uri, position: resolved.position, name: resolved.name ?? sym });
            }
            catch { }
        }
        if (entries.length === 0)
            return 'Error: Could not resolve any of the provided symbols.';
        // Phase 2: Build impact graph (simplified BFS)
        const visited = new Set();
        const fileSymbols = new Map();
        for (const entry of entries) {
            const queue = [
                { uri: entry.uri, position: entry.position, depth: 0 },
            ];
            while (queue.length > 0) {
                const current = queue.shift();
                if (current.depth > params.depth)
                    continue;
                const key = `${current.uri}:${current.position.line}`;
                if (visited.has(key))
                    continue;
                visited.add(key);
                const file = uriToPath(current.uri);
                const existing = fileSymbols.get(file);
                if (!existing || existing.depth > current.depth) {
                    fileSymbols.set(file, { depth: current.depth, symbols: [entry.name] });
                }
                // Find references at this position
                if (current.depth < params.depth) {
                    const refs = await engine.request('textDocument/references', {
                        textDocument: { uri: current.uri },
                        position: current.position,
                        context: { includeDeclaration: false },
                    }, timeout).catch(() => null);
                    if (refs) {
                        for (const ref of refs.slice(0, 20)) { // limit BFS breadth
                            queue.push({ uri: ref.uri, position: ref.range.start, depth: current.depth + 1 });
                        }
                    }
                }
            }
        }
        // Phase 3: Classify and budget
        const sorted = [...fileSymbols.entries()].sort((a, b) => a[1].depth - b[1].depth);
        const sections = {
            mustModify: [],
            verifyOnly: [],
            skip: [],
        };
        for (const [file, info] of sorted) {
            const rel = relativePath(file, engine.workspaceRoot);
            const isTest = /\.(spec|test|stories)\.(ts|tsx)$/.test(file);
            if (isTest) {
                sections.skip.push(rel);
                continue;
            }
            const category = info.depth === 0 ? 'must-modify' : info.depth === 1 ? 'verify-only' : 'skip';
            if (category === 'must-modify' && tokensUsed < params.max_tokens) {
                // Full function bodies for must-modify
                try {
                    const content = fs.readFileSync(file, 'utf-8');
                    const uri = `file://${file}`;
                    const symbols = await engine.request('textDocument/documentSymbol', { textDocument: { uri } }, timeout).catch(() => null);
                    if (symbols && symbols.length > 0) {
                        // Find the relevant symbol(s)
                        for (const sym of symbols) {
                            const body = extractSymbolBody(content, sym.range.start.line, Math.min(sym.range.end.line, sym.range.start.line + 30));
                            const tokens = estimateTokens(body);
                            if (tokensUsed + tokens <= params.max_tokens) {
                                sections.mustModify.push(`### ${rel}: ${sym.name}\n\`\`\`\n${body}\n\`\`\``);
                                tokensUsed += tokens;
                            }
                        }
                    }
                }
                catch { }
            }
            else if (category === 'verify-only' && tokensUsed < params.max_tokens) {
                // Signatures only for verify
                try {
                    const uri = `file://${file}`;
                    await engine.prepareFile(file);
                    const hover = await engine.request('textDocument/hover', {
                        textDocument: { uri },
                        position: { line: 0, character: 0 },
                    }, 5000).catch(() => null);
                    const sig = hover ? formatHover(hover) : '';
                    const sigText = sig ? `  ${sig.substring(0, 100)}` : '';
                    const tokens = estimateTokens(rel + sigText);
                    if (tokensUsed + tokens <= params.max_tokens) {
                        sections.verifyOnly.push(`- ${rel}${sigText}`);
                        tokensUsed += tokens;
                    }
                }
                catch {
                    sections.verifyOnly.push(`- ${rel}`);
                }
            }
            else {
                sections.skip.push(rel);
            }
        }
        // Phase 4: Format output
        const entryNames = params.symbols.join(', ');
        const lines = [`# Context for: ${entryNames}\n`];
        lines.push(`${visited.size} symbols traced, ~${tokensUsed} tokens used of ${params.max_tokens} budget\n`);
        if (sections.mustModify.length > 0) {
            lines.push(`## Must modify (${sections.mustModify.length} sections)\n`);
            lines.push(sections.mustModify.join('\n\n'));
            lines.push('');
        }
        if (sections.verifyOnly.length > 0) {
            lines.push(`\n## Verify only (${sections.verifyOnly.length} files)\n`);
            lines.push(sections.verifyOnly.join('\n'));
            lines.push('');
        }
        if (sections.skip.length > 0) {
            lines.push(`\n## Skip (${sections.skip.length} files — update after implementation)\n`);
            lines.push(sections.skip.map((f) => `- ${f}`).join('\n'));
        }
        return lines.join('\n');
    },
});
//# sourceMappingURL=gatherContext.js.map