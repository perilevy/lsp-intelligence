import { z } from 'zod';
import { defineTool } from '../registry.js';
import { toPosition, fromPosition, relativePath, uriToPath } from '../../engine/positions.js';
import type { CallHierarchyItem, CallHierarchyIncomingCall, CallHierarchyOutgoingCall } from 'vscode-languageserver-protocol';

export const callHierarchy = defineTool({
  name: 'call_hierarchy',
  description: 'Trace incoming callers or outgoing callees for a function/method. Use to understand call flow before modifying a function.',
  schema: z.object({
    symbol: z.string().optional().describe('Symbol name. Use this OR file_path+line+column.'),
    file_path: z.string().optional().describe('Absolute file path'),
    line: z.number().optional().describe('1-indexed line number'),
    column: z.number().optional().describe('1-indexed column number'),
    direction: z.enum(['incoming', 'outgoing']).default('incoming').describe('incoming = who calls this; outgoing = what this calls'),
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

    // Step 1: Prepare call hierarchy
    const items = await engine.request<CallHierarchyItem[] | null>(
      'textDocument/prepareCallHierarchy', { textDocument: { uri }, position }, 20_000,
    );
    if (!items || items.length === 0) return 'No call hierarchy available for this symbol.';
    const item = items[0];

    // Step 2: Get incoming or outgoing calls
    if (params.direction === 'incoming') {
      const calls = await engine.request<CallHierarchyIncomingCall[] | null>(
        'callHierarchy/incomingCalls', { item },
      );
      if (!calls || calls.length === 0) return `No incoming calls to ${item.name}.`;

      const lines = [`# Incoming Calls to ${item.name}\n\n${calls.length} callers\n`];
      for (const call of calls) {
        const rel = relativePath(uriToPath(call.from.uri), engine.workspaceRoot);
        const pos = fromPosition(call.from.selectionRange.start);
        lines.push(`- **${call.from.name}** — ${rel}:${pos.line}`);
      }
      return lines.join('\n');
    } else {
      const calls = await engine.request<CallHierarchyOutgoingCall[] | null>(
        'callHierarchy/outgoingCalls', { item },
      );
      if (!calls || calls.length === 0) return `No outgoing calls from ${item.name}.`;

      const lines = [`# Outgoing Calls from ${item.name}\n\n${calls.length} callees\n`];
      for (const call of calls) {
        const rel = relativePath(uriToPath(call.to.uri), engine.workspaceRoot);
        const pos = fromPosition(call.to.selectionRange.start);
        lines.push(`- **${call.to.name}** — ${rel}:${pos.line}`);
      }
      return lines.join('\n');
    }
  },
});
