import { z } from 'zod';
import { defineTool } from '../registry.js';
import { pathToUri, fromPosition, relativePath } from '../../engine/positions.js';
import { formatHover } from '../../format/markdown.js';
import type { Hover } from 'vscode-languageserver-protocol';
import { DEFAULT_TIMEOUTS } from '../../engine/types.js';

export const explainError = defineTool({
  name: 'explain_error',
  description: 'Explain a TypeScript error with full context: what type was expected, what was provided, and why. Turns cryptic TS errors into actionable fixes.',
  schema: z.object({
    file_path: z.string().describe('Absolute file path containing the error'),
    line: z.number().describe('1-indexed line number of the error'),
    column: z.number().optional().default(1).describe('1-indexed column number (defaults to 1)'),
  }),
  async handler(params, engine) {
    const { uri } = await engine.prepareFile(params.file_path);
    const timeout = DEFAULT_TIMEOUTS.composite;

    // Wait for diagnostics
    await new Promise((r) => setTimeout(r, 500));
    const diags = engine.docManager.getCachedDiagnostics(uri);

    // Find diagnostic at or near the specified line
    const targetLine = params.line - 1; // 0-indexed
    const diag = diags.find((d) => d.range.start.line === targetLine)
      ?? diags.find((d) => Math.abs(d.range.start.line - targetLine) <= 2);

    if (!diag) {
      const rel = relativePath(params.file_path, engine.workspaceRoot);
      return `No error found at ${rel}:${params.line}. File may be clean or diagnostics haven't been pushed yet.`;
    }

    const errorPos = { line: diag.range.start.line, character: diag.range.start.character };

    // Get hover info at the error position (type information)
    const hoverResult = await engine.request<Hover | null>(
      'textDocument/hover', { textDocument: { uri }, position: errorPos }, timeout,
    ).catch(() => null);

    // Get type definition to understand expected type
    const typeDef = await engine.request<any>(
      'textDocument/typeDefinition', { textDocument: { uri }, position: errorPos }, timeout,
    ).catch(() => null);

    const rel = relativePath(params.file_path, engine.workspaceRoot);
    const pos = fromPosition(diag.range.start);
    const severity = diag.severity === 1 ? 'Error' : diag.severity === 2 ? 'Warning' : 'Info';
    const code = diag.code ? `TS${diag.code}` : '';

    const lines = [`# ${severity}: ${rel}:${pos.line}\n`];
    lines.push(`**${code}**: ${diag.message}\n`);

    if (hoverResult) {
      const hoverText = formatHover(hoverResult);
      if (hoverText && !hoverText.includes('No hover')) {
        lines.push(`## Type at error location\n\n${hoverText}\n`);
      }
    }

    if (diag.relatedInformation) {
      lines.push('## Related\n');
      for (const related of diag.relatedInformation) {
        const relPath = relativePath(related.location.uri, engine.workspaceRoot);
        const relPos = fromPosition(related.location.range.start);
        lines.push(`- ${relPath}:${relPos.line}: ${related.message}`);
      }
    }

    return lines.join('\n');
  },
});
