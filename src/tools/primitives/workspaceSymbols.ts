import { z } from 'zod';
import { defineTool } from '../registry.js';
import { fromPosition, relativePath, uriToPath } from '../../engine/positions.js';
import type { SymbolInformation } from 'vscode-languageserver-protocol';

const SYMBOL_KINDS: Record<number, string> = {
  1: 'File', 2: 'Module', 5: 'Class', 6: 'Method', 7: 'Property',
  10: 'Enum', 11: 'Interface', 12: 'Function', 13: 'Variable', 14: 'Constant',
};

export const workspaceSymbols = defineTool({
  name: 'workspace_symbols',
  description: 'Search for symbols by name across the entire workspace. Use when you know a name but not its location.',
  schema: z.object({
    query: z.string().describe('Search query — symbol name or partial match'),
    limit: z.number().default(20).describe('Max results'),
  }),
  async handler(params, engine) {
    const result = await engine.request<SymbolInformation[] | null>('workspace/symbol', {
      query: params.query,
    });
    if (!result || result.length === 0) return `No symbols found matching "${params.query}".`;

    const limited = result.slice(0, params.limit);
    const lines = [`# Workspace Symbols: "${params.query}"\n\n${limited.length} results\n`];
    for (const sym of limited) {
      const kind = SYMBOL_KINDS[sym.kind] ?? 'Unknown';
      const pos = fromPosition(sym.location.range.start);
      const rel = relativePath(uriToPath(sym.location.uri), engine.workspaceRoot);
      lines.push(`- **${sym.name}** (${kind}) — ${rel}:${pos.line}`);
    }
    return lines.join('\n');
  },
});
