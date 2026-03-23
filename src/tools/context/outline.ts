import { z } from 'zod';
import { defineTool } from '../registry.js';
import { relativePath, pathToUri } from '../../engine/positions.js';
import { formatHover } from '../../format/markdown.js';
import type { DocumentSymbol, Hover } from 'vscode-languageserver-protocol';
import { DEFAULT_TIMEOUTS } from '../../engine/types.js';

const SYMBOL_KINDS: Record<number, string> = {
  5: 'class', 6: 'method', 7: 'property', 10: 'enum', 11: 'interface',
  12: 'function', 13: 'variable', 14: 'constant', 22: 'enum member',
};

export const outline = defineTool({
  name: 'outline',
  description: 'Get a file\'s structure with type signatures — understand a file in 50 tokens instead of reading 2000 lines. Shows classes, functions, interfaces with their signatures.',
  schema: z.object({
    file_path: z.string().describe('Absolute file path'),
    include_signatures: z.boolean().default(true).describe('Include type signatures from hover'),
  }),
  async handler(params, engine) {
    const { uri } = await engine.prepareFile(params.file_path);
    const timeout = DEFAULT_TIMEOUTS.context;

    const symbols = await engine.request<DocumentSymbol[] | null>(
      'textDocument/documentSymbol', { textDocument: { uri } }, timeout,
    );
    if (!symbols || symbols.length === 0) return 'No symbols found.';

    const rel = relativePath(params.file_path, engine.workspaceRoot);
    const lines: string[] = [`# ${rel}\n`];

    async function renderSymbol(sym: DocumentSymbol, indent: number): Promise<void> {
      const kind = SYMBOL_KINDS[sym.kind] ?? 'unknown';
      const prefix = indent === 0 ? '' : '  '.repeat(indent) + '├── ';
      let sig = '';

      if (params.include_signatures && indent < 2) {
        // Get hover for type signature (only top-level + 1 depth to limit requests)
        const hover = await engine.request<Hover | null>(
          'textDocument/hover', {
            textDocument: { uri },
            position: sym.selectionRange.start,
          }, 5000,
        ).catch(() => null);

        if (hover) {
          const hoverText = formatHover(hover);
          // Extract just the signature line (first code block content)
          const sigMatch = hoverText.match(/```\w*\n([^\n]+)/);
          if (sigMatch) sig = ` — \`${sigMatch[1].trim()}\``;
        }
      }

      lines.push(`${prefix}**${sym.name}** (${kind})${sig}`);

      if (sym.children) {
        for (const child of sym.children) {
          await renderSymbol(child, indent + 1);
        }
      }
    }

    for (const sym of symbols) {
      await renderSymbol(sym, 0);
    }

    return lines.join('\n');
  },
});
