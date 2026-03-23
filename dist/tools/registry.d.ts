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
export declare function defineTool<S extends ZodRawShape>(def: {
    name: string;
    description: string;
    schema: z.ZodObject<S>;
    annotations?: Record<string, boolean>;
    handler: (params: z.infer<z.ZodObject<S>>, engine: LspEngine) => Promise<string>;
}): ToolDef;
export declare function registerAll(server: McpServer, engine: LspEngine, tools: ToolDef[]): void;
