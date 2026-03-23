# LSP Intelligence — Agent Instructions

You have access to LSP-powered code intelligence tools. Use them instead of grep/read for code understanding tasks.

> **Note:** The first query in a session takes ~10s while the TypeScript engine warms up (scales with repo size). Subsequent queries are 100-300ms. This is normal — don't retry or report an error during warmup.

## When to use LSP tools

| You want to... | Instead of... | Use |
|----------------|---------------|-----|
| Find all usages of a function/type | `grep "symbolName"` | `find_references` |
| Jump to where something is defined | Reading imports, grepping | `goto_definition` |
| Understand a type or function signature | Reading the source file | `hover` |
| See what a file contains | `read` on the whole file | `outline` |
| Know what breaks if you change something | Multiple greps + manual tracing | `impact_trace` |
| Prepare context for a coding task | Reading 5-10 files | `gather_context` |
| Check for type errors after editing | Running `tsc` | `live_diagnostics` |
| Find which tests to update | Grepping for test files | `find_test_files` |
| Understand a TypeScript error | Reading error + source | `explain_error` |
| Get the right import path | Guessing from directory structure | `auto_import` |
| Look up multiple symbols at once | Multiple separate queries | `batch_query` |
| Review what you changed semantically | `git diff` | `semantic_diff` |

## When to still use grep

- Searching for string literals, comments, or config values
- Searching non-TypeScript files (markdown, JSON, YAML)
- Simple text pattern matching where semantic understanding isn't needed

## Workflow patterns

### Before modifying code

1. `outline` on the file — understand structure without reading everything
2. `impact_trace` on the symbol you're changing — know the blast radius
3. `gather_context` with the affected symbols — get only relevant code
4. `find_test_files` — know which tests to update

### While implementing

- `hover` to check types before writing code
- `auto_import` to get import paths right
- `goto_definition` to navigate to source when you need implementation details
- `find_references` to verify you're not missing usages

### After editing

- `live_diagnostics` on every file you changed — catch type errors immediately
- If errors: `explain_error` for actionable fix suggestions
- `semantic_diff` before committing — verify your changes make sense

## Symbol-name input

All tools accept symbol names directly: `{ "symbol": "UserService" }`. You don't need to figure out the file path and line number first. Use this whenever possible — it's faster and less error-prone than position-based queries.

Only fall back to `{ "file_path", "line", "column" }` when the symbol name is ambiguous (multiple symbols with the same name across packages).
