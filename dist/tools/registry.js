export function defineTool(def) {
    return def;
}
export function registerAll(server, engine, tools) {
    for (const tool of tools) {
        server.tool(tool.name, tool.description, tool.schema.shape, async (params) => {
            try {
                const parsed = tool.schema.parse(params);
                const result = await tool.handler(parsed, engine);
                // Structured object → JSON text
                if (typeof result === 'object' && result !== null) {
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                }
                // String → pass through (backward compat)
                return { content: [{ type: 'text', text: result }] };
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
            }
        });
    }
}
//# sourceMappingURL=registry.js.map