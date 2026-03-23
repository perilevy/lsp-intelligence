import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZodRawShape } from 'zod';
import { z } from 'zod';
import type { LspEngine } from '../engine/LspEngine.js';

export interface ToolDef {
  name: string;
  description: string;
  schema: z.ZodObject<any>;
  annotations?: Record<string, boolean>;
  handler: (params: any, engine: LspEngine) => Promise<string>;
}

export function defineTool<S extends ZodRawShape>(def: {
  name: string;
  description: string;
  schema: z.ZodObject<S>;
  annotations?: Record<string, boolean>;
  handler: (params: z.infer<z.ZodObject<S>>, engine: LspEngine) => Promise<string>;
}): ToolDef {
  return def as ToolDef;
}

export function registerAll(server: McpServer, engine: LspEngine, tools: ToolDef[]): void {
  for (const tool of tools) {
    server.tool(
      tool.name,
      tool.description,
      tool.schema.shape,
      async (params: Record<string, unknown>) => {
        try {
          const parsed = tool.schema.parse(params);
          const text = await tool.handler(parsed, engine);
          return { content: [{ type: 'text' as const, text }] };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
        }
      },
    );
  }
}
