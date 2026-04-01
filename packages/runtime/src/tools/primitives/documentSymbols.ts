import { z } from 'zod';
import { defineTool } from '../registry.js';
import { relativePath } from '../../engine/positions.js';
import type { DocumentSymbol } from 'vscode-languageserver-protocol';

const SYMBOL_KINDS: Record<number, string> = {
  1: 'File', 2: 'Module', 3: 'Namespace', 4: 'Package', 5: 'Class',
  6: 'Method', 7: 'Property', 8: 'Field', 9: 'Constructor', 10: 'Enum',
  11: 'Interface', 12: 'Function', 13: 'Variable', 14: 'Constant',
  15: 'String', 16: 'Number', 17: 'Boolean', 18: 'Array', 19: 'Object',
  20: 'Key', 21: 'Null', 22: 'EnumMember', 23: 'Struct', 24: 'Event',
  25: 'Operator', 26: 'TypeParameter',
};

function formatSymbolTree(symbols: DocumentSymbol[], indent = 0): string {
  const lines: string[] = [];
  for (const sym of symbols) {
    const kind = SYMBOL_KINDS[sym.kind] ?? 'Unknown';
    const line = sym.range.start.line + 1;
    const prefix = '  '.repeat(indent) + (indent > 0 ? '├── ' : '');
    lines.push(`${prefix}${sym.name} (${kind}, L${line})`);
    if (sym.children) {
      lines.push(formatSymbolTree(sym.children, indent + 1));
    }
  }
  return lines.join('\n');
}

export const documentSymbols = defineTool({
  name: 'document_symbols',
  description: 'List all symbols in a file — functions, classes, interfaces, variables. Use to understand file structure without reading the full file.',
  schema: z.object({
    file_path: z.string().describe('Absolute file path'),
  }),
  async handler(params, engine) {
    const { uri } = await engine.prepareFile(params.file_path);
    const result = await engine.request<DocumentSymbol[] | null>('textDocument/documentSymbol', {
      textDocument: { uri },
    });
    if (!result || result.length === 0) return 'No symbols found.';
    const rel = relativePath(params.file_path, engine.workspaceRoot);
    return `# Symbols in ${rel}\n\n${formatSymbolTree(result)}`;
  },
});
