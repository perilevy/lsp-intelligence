import { z } from 'zod';
import { defineTool } from '../registry.js';
import { relativePath, fromPosition } from '../../engine/positions.js';

const SEVERITY: Record<number, string> = { 1: 'Error', 2: 'Warning', 3: 'Info', 4: 'Hint' };

export const liveDiagnostics = defineTool({
  name: 'live_diagnostics',
  description: 'Re-read a file from disk and check for new type errors. Use after editing a file to immediately see if the change broke types.',
  schema: z.object({
    file_path: z.string().describe('Absolute file path to check'),
  }),
  annotations: { readOnlyHint: false },
  async handler(params, engine) {
    // Re-read from disk (file was just edited)
    await engine.prepareFile(params.file_path);
    if (!(engine as any).connection) return 'Error: LSP connection not available.';
    await engine.docManager.refreshFromDisk(params.file_path, (engine as any).connection);

    // Wait for TSServer to process changes
    await new Promise((r) => setTimeout(r, 1000));

    const uri = `file://${params.file_path}`;
    const diags = engine.docManager.getCachedDiagnostics(uri);
    const rel = relativePath(params.file_path, engine.workspaceRoot);

    if (diags.length === 0) return `✅ ${rel} — no errors after edit.`;

    const errors = diags.filter((d) => d.severity === 1);
    const warnings = diags.filter((d) => d.severity === 2);

    const lines = [`# Live Diagnostics: ${rel}\n`];
    lines.push(`${errors.length} errors, ${warnings.length} warnings\n`);

    for (const d of diags.sort((a, b) => a.range.start.line - b.range.start.line)) {
      const severity = SEVERITY[d.severity ?? 1];
      const pos = fromPosition(d.range.start);
      const code = d.code ? ` (TS${d.code})` : '';
      lines.push(`- **${severity}** L${pos.line}${code}: ${d.message}`);
    }

    return lines.join('\n');
  },
});
