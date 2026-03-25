#!/usr/bin/env node
import { createRequire } from 'module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
const require = createRequire(import.meta.url);
const { version } = require('../package.json');
import { LspEngine } from './engine/LspEngine.js';
import { registerAll } from './tools/registry.js';
// Primitives
import { findReferences } from './tools/primitives/findReferences.js';
import { gotoDefinition } from './tools/primitives/gotoDefinition.js';
import { gotoTypeDefinition } from './tools/primitives/gotoTypeDefinition.js';
import { hover } from './tools/primitives/hover.js';
import { findImplementations } from './tools/primitives/findImplementations.js';
import { documentSymbols } from './tools/primitives/documentSymbols.js';
import { workspaceSymbols } from './tools/primitives/workspaceSymbols.js';
import { callHierarchy } from './tools/primitives/callHierarchy.js';
import { rename } from './tools/primitives/rename.js';
import { diagnostics } from './tools/primitives/diagnostics.js';
import { completions } from './tools/primitives/completions.js';
import { fileImports } from './tools/primitives/fileImports.js';
import { fileExports } from './tools/primitives/fileExports.js';
// Composites
import { inspectSymbol } from './tools/composites/inspectSymbol.js';
import { batchQuery } from './tools/composites/batchQuery.js';
import { impactTrace } from './tools/composites/impactTrace.js';
import { semanticDiff } from './tools/composites/semanticDiff.js';
import { findTestFiles } from './tools/composites/findTestFiles.js';
import { explainError } from './tools/composites/explainError.js';
import { findPattern } from './tools/composites/findPattern.js';
import { findCodeByBehavior } from './tools/composites/findCodeByBehavior.js';
// Context
import { outline } from './tools/context/outline.js';
import { gatherContext } from './tools/context/gatherContext.js';
// Live
import { liveDiagnostics } from './tools/live/liveDiagnostics.js';
import { findUnusedExports } from './tools/live/findUnusedExports.js';
import { autoImport } from './tools/live/autoImport.js';
const workspaceRoot = process.env.LSP_WORKSPACE_ROOT || process.cwd();
async function main() {
    console.error(`[lsp-intelligence] Starting with workspace: ${workspaceRoot}`);
    const engine = new LspEngine(workspaceRoot);
    const server = new McpServer({ name: 'lsp-intelligence', version }, { capabilities: { tools: {} } });
    registerAll(server, engine, [
        // Layer 1: Primitives
        findReferences,
        gotoDefinition,
        gotoTypeDefinition,
        hover,
        findImplementations,
        documentSymbols,
        workspaceSymbols,
        callHierarchy,
        rename,
        diagnostics,
        completions,
        fileImports,
        fileExports,
        // Layer 2: Composites
        inspectSymbol,
        batchQuery,
        impactTrace,
        semanticDiff,
        findTestFiles,
        explainError,
        findPattern,
        findCodeByBehavior,
        // Layer 3: Context
        outline,
        gatherContext,
        // Layer 4: Live
        liveDiagnostics,
        findUnusedExports,
        autoImport,
    ]);
    engine.initialize().catch((err) => {
        console.error(`[lsp-intelligence] Engine initialization failed: ${err.message}`);
    });
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[lsp-intelligence] MCP server running on stdio');
    process.on('SIGTERM', async () => { await engine.shutdown(); process.exit(0); });
    process.on('SIGINT', async () => { await engine.shutdown(); process.exit(0); });
}
main().catch((err) => {
    console.error(`[lsp-intelligence] Fatal: ${err.message}`);
    process.exit(1);
});
//# sourceMappingURL=index.js.map