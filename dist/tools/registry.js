export function defineTool(def) {
    return def;
}
export function registerAll(server, engine, tools) {
    for (const tool of tools) {
        server.tool(tool.name, tool.description, tool.schema.shape, async (params) => {
            try {
                const parsed = tool.schema.parse(params);
                const text = await tool.handler(parsed, engine);
                return { content: [{ type: 'text', text }] };
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
            }
        });
    }
}
//# sourceMappingURL=registry.js.map