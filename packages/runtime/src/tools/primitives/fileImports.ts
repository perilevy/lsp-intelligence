import { z } from 'zod';
import * as fs from 'fs';
import { defineTool } from '../registry.js';
import { relativePath } from '../../engine/positions.js';

interface ImportInfo {
  module: string;
  symbols: string[];
  line: number;
  isDefault: boolean;
  isNamespace: boolean;
}

function parseImports(content: string): ImportInfo[] {
  const imports: ImportInfo[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Named imports: import { A, B } from "module"
    const named = line.match(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/);
    if (named) {
      const symbols = named[1].split(',').map((s) => s.trim().split(' as ')[0].trim()).filter(Boolean);
      imports.push({ module: named[2], symbols, line: i + 1, isDefault: false, isNamespace: false });
      continue;
    }
    // Default import: import Name from "module"
    const def = line.match(/import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/);
    if (def) {
      imports.push({ module: def[2], symbols: [def[1]], line: i + 1, isDefault: true, isNamespace: false });
      continue;
    }
    // Namespace import: import * as Name from "module"
    const ns = line.match(/import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/);
    if (ns) {
      imports.push({ module: ns[2], symbols: [ns[1]], line: i + 1, isDefault: false, isNamespace: true });
      continue;
    }
    // Side-effect import: import "module"
    const side = line.match(/import\s+['"]([^'"]+)['"]/);
    if (side) {
      imports.push({ module: side[1], symbols: [], line: i + 1, isDefault: false, isNamespace: false });
    }
  }
  return imports;
}

export const fileImports = defineTool({
  name: 'file_imports',
  description: 'List all imports of a file — modules, symbols, and line numbers.',
  schema: z.object({
    file_path: z.string().describe('Absolute file path'),
  }),
  async handler(params, engine) {
    const content = fs.readFileSync(params.file_path, 'utf-8');
    const imports = parseImports(content);

    if (imports.length === 0) return 'No imports found.';

    const rel = relativePath(params.file_path, engine.workspaceRoot);
    const lines = [`# Imports: ${rel}\n\n${imports.length} imports\n`];
    for (const imp of imports) {
      const symbolList = imp.symbols.length > 0 ? `{ ${imp.symbols.join(', ')} }` : '(side-effect)';
      const tag = imp.isDefault ? '[default]' : imp.isNamespace ? '[namespace]' : '';
      lines.push(`- L${imp.line}: \`${imp.module}\` → ${symbolList} ${tag}`.trim());
    }
    return lines.join('\n');
  },
});
