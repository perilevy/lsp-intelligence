import { z } from 'zod';
import { defineTool } from '../registry.js';
import { relativePath, fromPosition } from '../../engine/positions.js';
import type { DocumentSymbol } from 'vscode-languageserver-protocol';
import * as fs from 'fs';

const SYMBOL_KINDS: Record<number, string> = {
  5: 'Class', 6: 'Method', 10: 'Enum', 11: 'Interface',
  12: 'Function', 13: 'Variable', 14: 'Constant',
};

export const fileExports = defineTool({
  name: 'file_exports',
  description: "List a file's public API — all exported symbols with their kinds.",
  schema: z.object({
    file_path: z.string().describe('Absolute file path'),
  }),
  async handler(params, engine) {
    const content = fs.readFileSync(params.file_path, 'utf-8');
    const { uri } = await engine.prepareFile(params.file_path);

    const symbols = await engine.request<DocumentSymbol[] | null>('textDocument/documentSymbol', {
      textDocument: { uri },
    });

    const lines1 = content.split('\n');
    const exported: { name: string; kind: string; line: number }[] = [];

    // Use document symbols + check if the line contains 'export'
    if (symbols) {
      const collect = (syms: DocumentSymbol[]) => {
        for (const sym of syms) {
          const lineNum = sym.range.start.line;
          const lineText = lines1[lineNum] ?? '';
          if (lineText.includes('export')) {
            exported.push({
              name: sym.name,
              kind: SYMBOL_KINDS[sym.kind] ?? 'Unknown',
              line: lineNum + 1,
            });
          }
          if (sym.children) collect(sym.children);
        }
      };
      collect(symbols);
    }

    // Also catch re-exports: export { X } from "./module"
    for (let i = 0; i < lines1.length; i++) {
      const match = lines1[i].match(/export\s+\{([^}]+)\}\s+from/);
      if (match) {
        const names = match[1].split(',').map((s) => s.trim().split(' as ')[0].trim());
        for (const name of names) {
          if (!exported.some((e) => e.name === name)) {
            exported.push({ name, kind: 're-export', line: i + 1 });
          }
        }
      }
      // export * from
      const starMatch = lines1[i].match(/export\s+\*\s+from\s+['"]([^'"]+)['"]/);
      if (starMatch) {
        exported.push({ name: `* from "${starMatch[1]}"`, kind: 'barrel', line: i + 1 });
      }
    }

    if (exported.length === 0) return 'No exports found.';

    const rel = relativePath(params.file_path, engine.workspaceRoot);
    const result = [`# Exports: ${rel}\n\n${exported.length} exports\n`];
    for (const exp of exported.sort((a, b) => a.line - b.line)) {
      result.push(`- L${exp.line}: **${exp.name}** (${exp.kind})`);
    }
    return result.join('\n');
  },
});
