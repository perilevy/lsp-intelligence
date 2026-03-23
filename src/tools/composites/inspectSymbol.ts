import { z } from 'zod';
import { defineTool } from '../registry.js';
import { toPosition, fromPosition, relativePath, uriToPath } from '../../engine/positions.js';
import { formatHover, formatReferences, formatDefinitions } from '../../format/markdown.js';
import type { Location, Hover } from 'vscode-languageserver-protocol';
import { DEFAULT_TIMEOUTS } from '../../engine/types.js';

export const inspectSymbol = defineTool({
  name: 'inspect_symbol',
  description: 'Get complete information about a symbol in one call: hover (type signature), definition location, and all references. Use when you need full context about a symbol.',
  schema: z.object({
    symbol: z.string().optional().describe('Symbol name. Use this OR file_path+line+column.'),
    file_path: z.string().optional().describe('Absolute file path'),
    line: z.number().optional().describe('1-indexed line number'),
    column: z.number().optional().describe('1-indexed column number'),
    verbosity: z.enum(['summary', 'normal', 'detailed']).default('normal'),
  }),
  async handler(params, engine) {
    let uri: string, position: { line: number; character: number };
    if (params.symbol) {
      const resolved = await engine.resolveSymbol(params.symbol, params.file_path);
      uri = resolved.uri; position = resolved.position;
    } else if (params.file_path && params.line && params.column) {
      const prepared = await engine.prepareFile(params.file_path);
      uri = prepared.uri; position = toPosition(params.line, params.column);
    } else {
      return 'Error: Provide either symbol name or file_path + line + column.';
    }

    const timeout = DEFAULT_TIMEOUTS.composite;

    // Run hover, definition, references in parallel
    const [hoverResult, defResult, refsResult] = await Promise.all([
      engine.request<Hover | null>('textDocument/hover', { textDocument: { uri }, position }, timeout).catch(() => null),
      engine.request<Location | Location[] | null>('textDocument/definition', { textDocument: { uri }, position }, timeout).catch(() => null),
      engine.request<Location[] | null>('textDocument/references', {
        textDocument: { uri }, position, context: { includeDeclaration: false },
      }, timeout).catch(() => null),
    ]);

    const name = params.symbol ?? 'symbol';
    const sections: string[] = [`# Inspect: ${name}\n`];

    // Hover / type signature
    const hoverText = formatHover(hoverResult);
    if (hoverText && !hoverText.includes('No hover')) {
      sections.push(`## Type\n\n${hoverText}\n`);
    }

    // Definition
    const defText = formatDefinitions(defResult, engine.workspaceRoot);
    if (!defText.includes('No definition')) {
      sections.push(defText.replace('# Definition', '## Definition'));
    }

    // References
    const refsText = formatReferences(refsResult, engine.workspaceRoot, params.verbosity as any);
    if (!refsText.includes('No references')) {
      sections.push(refsText.replace('# References', '## References'));
    }

    return sections.join('\n');
  },
});
