import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZodRawShape } from 'zod';
import { z } from 'zod';
import type { LspEngine } from '../engine/LspEngine.js';

/**
 * Tool result: either a formatted string or a structured object.
 * Structured objects are JSON-serialized for the MCP response.
 * Skills and formatting layers consume the structured data.
 */
export type ToolResult = string | { [key: string]: any };

export interface ToolDef {
  name: string;
  description: string;
  schema: z.ZodObject<any>;
  annotations?: Record<string, boolean>;
  handler: (params: any, engine: LspEngine) => Promise<ToolResult>;
}

export function defineTool<S extends ZodRawShape>(def: {
  name: string;
  description: string;
  schema: z.ZodObject<S>;
  annotations?: Record<string, boolean>;
  handler: (params: z.infer<z.ZodObject<S>>, engine: LspEngine) => Promise<ToolResult>;
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
          const result = await tool.handler(parsed, engine);

          // Structured object → JSON text
          if (typeof result === 'object' && result !== null) {
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
          }

          // String → pass through (backward compat)
          return { content: [{ type: 'text' as const, text: result }] };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
        }
      },
    );
  }
}
