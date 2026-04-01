# lsp-intelligence

Local code intelligence for real engineering workflows.

**Find** implementations, API usage, structural patterns, configs, and routes. **Explain** why something broke. **Guard** the API contract before merging.

29 MCP tools across 5 layers. Supports **TypeScript and JavaScript** (TS, TSX, JS, JSX, MJS, CJS). Local-only — no paid API, no external calls.

## Why this exists

AI coding agents use `grep` to understand code. Grep finds text, not meaning. It can't follow types through aliases, can't distinguish imports from function calls, and returns false positives from comments and strings.

`lsp-intelligence` gives agents the same code understanding that VS Code has — type-aware references, call hierarchies, impact analysis — via the [Model Context Protocol](https://modelcontextprotocol.io/) (MCP).

## Quick start

After [installation](#installation), try in Claude Code:

```
"What breaks if I rename the UserService class?"
```

Under the hood, the agent calls:

```json
{ "tool": "impact_trace", "arguments": { "symbol": "UserService" } }
```

Or get a file overview without reading it:

```json
{ "tool": "outline", "arguments": { "file_path": "/workspace/src/services/auth.ts" } }
```

> All tools that accept `file_path` require absolute paths.

## Installation

Requires **Node.js 20+**.

### Option 1: Plugin install (recommended)

Add the marketplace and install the plugin:

```shell
/plugin marketplace add perilevy/lsp-intelligence
/plugin install lsp-intelligence@lsp-intelligence
/reload-plugins
```

The runtime is installed automatically on first session start. If auto-setup doesn't work (enterprise proxy, timeout), run once:

```bash
node ~/.claude/plugins/cache/lsp-intelligence/lsp-intelligence/*/scripts/install-runtime.mjs
```

### Option 2: Project configuration (team setup)

Add to your project's `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "lsp-intelligence": {
      "source": {
        "source": "github",
        "repo": "perilevy/lsp-intelligence"
      }
    }
  },
  "enabledPlugins": {
    "lsp-intelligence@lsp-intelligence": true
  }
}
```

### Option 3: MCP server only (no plugin)

For other AI agents or if you only want the raw MCP tools:

```json
{
  "mcpServers": {
    "lsp": {
      "command": "npx",
      "args": ["-y", "lsp-intelligence"],
      "env": { "LSP_WORKSPACE_ROOT": "${CLAUDE_PROJECT_DIR}" }
    }
  }
}
```

### Troubleshooting

If the MCP server doesn't connect:

```bash
# Check runtime health
node ~/.claude/plugins/cache/lsp-intelligence/lsp-intelligence/*/scripts/doctor-runtime.mjs

# Reinstall runtime
node ~/.claude/plugins/cache/lsp-intelligence/lsp-intelligence/*/scripts/install-runtime.mjs

# Or install globally
npm install -g lsp-intelligence@0.2.2-beta.1
```
```

## Capabilities

### LSP vs text search

| Query | Text search (grep) | lsp-intelligence |
|-------|-------------------|-----------------|
| Find all references to a function | Finds text matches | **Semantic references** — no false positives from comments or strings |
| Find references to a type alias | ⚠️ Includes substring matches (e.g. `UserServiceConfig` matches `UserService`) | **Exact symbol resolution** — only true references |
| Cross-package references in monorepo | ⚠️ Text matches only — includes false positives, can't distinguish import vs call vs type annotation | **Type-aware semantic references** across packages |

### What agents can do with LSP that they can't with grep

| Capability | Description |
|-----------|-------------|
| Follow type aliases | Trace through `ReturnType<typeof X>`, re-exports, and barrel files |
| Go to definition | Jump to the actual source, not just a text match |
| Call hierarchy | "Who calls this function?" / "What does this function call?" |
| Type signatures | Get the full type signature without reading the implementation |
| Impact analysis | "What breaks if I change this?" — one call, full answer |
| Semantic diff | Git changes → which symbols changed → blast radius per symbol |
| Context building | Trace an impact graph, extract only relevant code, token-budget the output |
| Rename preview | See every file that would change before committing a rename |
| Dead code detection | Find exports that nothing imports |
| Auto-import | Resolve the correct import path for any symbol |

### Performance

Tested on a TypeScript monorepo (9 packages, ~200k LOC):

| Metric | Value |
|--------|-------|
| Engine ready | ~10s (scales with repo size) |
| Queries after warmup | 100-300ms |
| 21 queries end-to-end | ~16s total |

The engine initializes once per session and stays warm. Warmup includes spawning TypeScript Server and pre-opening all monorepo packages. Queries start as soon as the index is available — no fixed delay.

## Tools

### Layer 1: Primitives (13 tools)

Direct LSP wrappers. Every tool accepts **symbol names** — agents never need to guess line numbers.

| Tool | Description |
|------|-------------|
| `find_references` | Find every usage of a symbol across the codebase. Semantic, not text. |
| `goto_definition` | Jump to where a symbol is defined. Follows imports and re-exports. |
| `goto_type_definition` | Find the type that defines a variable. |
| `hover` | Get full type signature and documentation. |
| `find_implementations` | Find concrete implementations of an interface. |
| `document_symbols` | List all symbols in a file. |
| `workspace_symbols` | Search for symbols by name across the workspace. |
| `call_hierarchy` | Trace incoming callers or outgoing callees. |
| `rename` | Preview a semantic rename across the codebase (dry-run by default). |
| `diagnostics` | Get type errors and warnings for a file. |
| `completions` | Code completion suggestions. |
| `file_imports` | List all imports of a file. |
| `file_exports` | List a file's public API including re-exports. |

### Layer 2: Intelligence Tools (10 tools)

Combine LSP, AST, and Git substrates into high-level operations.

| Tool | Description |
|------|-------------|
| `api_guard` | Detect public API contract changes — export diffs, structural classification, consumer impact, semver summary. |
| `root_cause_trace` | Trace the root cause of a TypeScript error — find the originating declaration change, not just the symptom. |
| `find_code` | Unified code search: behavior discovery, identifier/API usage, structural queries, config/route lookup, and implementation-root discovery. Routes automatically. |
| `find_pattern` | AST structural search — find code by pattern (e.g. `useEffect($$$)`, `try { $$$ } catch ($E) { $$$ }`). |
| `inspect_symbol` | Hover + definition + references in one call. Full context about any symbol. |
| `batch_query` | Look up multiple symbols at once. Saves round-trips when exploring. |
| `impact_trace` | Follow a symbol through type aliases and re-exports to find ALL transitive usages. |
| `semantic_diff` | Analyze git diff semantically: identify changed symbols and their blast radius. |
| `find_test_files` | Find all test/spec/stories files that reference a symbol. |
| `explain_error` | Turn a TypeScript error into actionable context: expected type, actual type, and fix suggestion. |

### Layer 3: Context Engine (2 tools)

Token-aware context building for agents.

| Tool | Description |
|------|-------------|
| `outline` | File structure with type signatures — understand a file without reading it. |
| `gather_context` | Trace impact graph from entry symbols, classify files as must-modify / verify-only / skip, return token-budgeted context. |

### Layer 4: Live Intelligence (3 tools)

Post-edit verification.

| Tool | Description |
|------|-------------|
| `live_diagnostics` | Re-read a file after editing and check for new type errors. |
| `find_unused_exports` | Find exported symbols with zero cross-package importers. |
| `auto_import` | Resolve the correct import path for a symbol name. |

## find_code query classes

`find_code` supports five query classes, routed automatically:

| Class | Example query | What happens |
|-------|--------------|-------------|
| **Identifier / API usage** | `useEffect`, `Promise.all` | Usage index → exact call/import sites with enclosing context |
| **Structural** | `useEffect that returns cleanup conditionally` | Identifier + structural predicates → AST evaluation on located nodes |
| **Behavior / entrypoint** | `where do we validate permissions` | Fielded BM25 over declarations + JSDoc/comments + family hints |
| **Config / route / flag** | `where is the feature flag configured` | Config index → JSON/YAML/package.json + env usage in code |
| **Implementation root** | `where is this actually implemented` | Graph expansion → wrapper detection → root promotion |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ Layer 4: Live Intelligence              [state-mutating] │
│   live_diagnostics, find_unused_exports, auto_import    │
├─────────────────────────────────────────────────────────┤
│ Layer 3: Context Engine                 [read-only]      │
│   gather_context, outline                               │
├─────────────────────────────────────────────────────────┤
│ Layer 2: Intelligence Tools              [read-only]      │
│   find_code, find_pattern, root_cause_trace, api_guard, │
│   impact_trace, semantic_diff, inspect_symbol,          │
│   batch_query, find_test_files, explain_error           │
├─────────────────────────────────────────────────────────┤
│ Layer 1: Primitives                     [read-only]      │
│   find_references, hover, definition, call_hierarchy,   │
│   rename, diagnostics, symbols, imports, exports        │
├─────────────────────────────────────────────────────────┤
│ Layer 0: Analysis Substrates            [infrastructure]  │
│   LSP Engine (TypeScript Server, symbol resolver)       │
│   TypeScript AST (declarations, usages, predicates)     │
│   Local text/regex search (recipe-compiled patterns)    │
│   Config/doc indexes (JSON, YAML, env, JSDoc, comments) │
│   Graph expansion (wrapper detection, root promotion)   │
│   Git integration (semantic diff, base comparison)      │
└─────────────────────────────────────────────────────────┘
```

Each layer only depends on layers below it.

### Monorepo Support

Works with any monorepo structure out of the box:

- `packages/`, `apps/`, `libs/`, `modules/`, `services/` directory conventions
- `pnpm-workspace.yaml`
- `package.json` workspaces (yarn, npm)

At startup, the engine discovers all workspace packages and pre-opens one file per package. This triggers TypeScript Server to build configured projects for every package, enabling cross-package reference finding — a common challenge with LSP tooling in monorepos.

### Symbol-Name Resolution

Every tool accepts `{ symbol: "UserService" }` instead of requiring `{ file_path, line, column }`. The engine resolves names to positions via `workspace/symbol` with priority sorting. Agents never need to guess line numbers.

## Installation

Requires **Node.js 20+**.

### Option 1: Claude Code plugin (recommended)

Installs the MCP server, hooks, and skills (`/find`, `/why`, `/api-check`, `/verify`, `/check`, `/impact`, `/context`, `/diff`) as a single package.

```bash
claude plugin add perilevy/lsp-intelligence
```

> The full experience — the agent gets code intelligence tools, guided workflows via skills, and automatic hooks.

### Option 2: MCP server only

For other AI agents (Copilot, Cursor, etc.) or if you only want the raw tools without hooks and skills.

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "lsp": {
      "command": "npx",
      "args": ["-y", "lsp-intelligence"],
      "env": {
        "LSP_WORKSPACE_ROOT": "${CLAUDE_PROJECT_DIR}"
      }
    }
  }
}
```

### Option 3: From source

For contributors or debugging.

```bash
git clone https://github.com/perilevy/lsp-intelligence.git
cd lsp-intelligence
yarn install && yarn build
```

Then in `.mcp.json`:

```json
{
  "mcpServers": {
    "lsp": {
      "command": "node",
      "args": ["/absolute/path/to/lsp-intelligence/dist/index.js"],
      "env": {
        "LSP_WORKSPACE_ROOT": "${CLAUDE_PROJECT_DIR}"
      }
    }
  }
}
```

## Development

```bash
git clone https://github.com/perilevy/lsp-intelligence.git
cd lsp-intelligence
yarn install
yarn build       # clean build (rm -rf dist && tsc)
yarn test        # vitest
yarn typecheck   # TypeScript strict mode — no emit
yarn bench       # search quality benchmarks
```

### Testing

Tests verify cross-package reference resolution, symbol-name lookup, type alias tracing, impact trace traversal, search quality, context building, and output formatting — all against self-contained fixture repos at `test-fixtures/`. No external dependencies needed.

### Benchmarks

`benchmarks/` contains reproducible quality cases for `find_code`, `root_cause_trace`, and `api_guard`. Every serious real-world failure should become a benchmark case.

## What this is not

- **Not a universal semantic search engine.** Strong on code structure, API usage, configs, and known patterns. Does not understand arbitrary business logic.
- **Not a replacement for full-text search.** Use grep for literal string matching. `find_code` uses text patterns internally but optimizes for code-aware ranking.
- **Not an AI model.** All intelligence is local: AST analysis, LSP queries, fielded text ranking, adapter recipes. No paid API calls, no external services.
- **Does not index secret-bearing `.env` files.** Env variable usage in code (`process.env.X`, `import.meta.env.X`) is indexed and searchable. Non-secret template/example files (`.env.example`, `.env.template`) are indexed. Real `.env` files are excluded by default.

## Dependencies

All dependencies are installed automatically. Under the hood: [`typescript-language-server`](https://github.com/typescript-language-server/typescript-language-server) for LSP, [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) for MCP, [`@ast-grep/napi`](https://github.com/ast-grep/ast-grep) for structural patterns. Uses your project's own TypeScript version.

## License

[MIT](LICENSE)
