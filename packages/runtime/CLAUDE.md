# LSP Intelligence — Agent Instructions

Local code intelligence for real engineering workflows. **Find** code, **explain** failures, **guard** API contracts.

> **Note:** The first query in a new session may take a few seconds while the TypeScript engine warms up. The workspace index is persisted and loads instantly on repeat sessions. Subsequent queries are 100-300ms.

## Primary tools

| Workflow | Tool | Skill |
|----------|------|-------|
| Find code by intent | `find_code` | `/find` |
| Find structural patterns | `find_pattern` | — |
| Trace root cause of an error | `root_cause_trace` | `/why` |
| Check API contract changes | `api_guard` | `/api-check` |
| Full pre-merge verification | `verify_changes` | `/verify` |

## When to use LSP tools

| You want to... | Instead of... | Use |
|----------------|---------------|-----|
| Find where an API is used | `grep "symbolName"` | `find_code` or `find_references` |
| Find implementations by concept | Multiple greps | `find_code` (auto-routes to behavior search) |
| Find structural patterns | Manual code reading | `find_code` or `find_pattern` |
| Find config/route/flag definitions | Grepping JSON/YAML | `find_code` with config focus |
| Jump to a definition | Reading imports | `goto_definition` |
| Understand a type signature | Reading the source file | `hover` |
| See what a file contains | `read` on the whole file | `outline` |
| Know what breaks if you change something | Manual tracing | `impact_trace` |
| Prepare context for a coding task | Reading 5-10 files | `gather_context` |
| Check for type errors after editing | Running `tsc` | `live_diagnostics` |
| Understand a TypeScript error | Reading error + source | `explain_error` / `/why` |
| Review what you changed semantically | `git diff` | `semantic_diff` |

## When to still use grep

- Searching for string literals in comments or logs
- Searching non-code files where LSP has no coverage
- Simple text matching where code-aware ranking isn't needed

## Workflow patterns

### Before modifying code
1. `outline` — understand structure without reading everything
2. `impact_trace` — know the blast radius
3. `gather_context` — get only relevant code, token-budgeted
4. `find_test_files` — know which tests to update

### While implementing
- `hover` to check types before writing
- `auto_import` to get import paths right
- `goto_definition` to navigate to source
- `find_references` to verify you're not missing usages

### After editing
- `live_diagnostics` on every file you changed
- If errors: `explain_error` or `/why` for root cause
- `semantic_diff` before committing
- `api_guard` or `/api-check` if exports changed

## Symbol-name input

All tools accept symbol names directly: `{ "symbol": "UserService" }`. You don't need file paths and line numbers. Only fall back to position-based input when the symbol name is ambiguous across packages.

## Skills

| Skill | Purpose |
|-------|---------|
| `/find <query>` | Guided code search with follow-up actions |
| `/why <file:line>` | Root cause trace with evidence chain |
| `/api-check` | API contract guard with semver verdict |
| `/verify` | Full pre-merge: types + API + test coverage |
| `/check <files>` | Type check with error explanations |
| `/impact <symbol>` | Transitive usage trace |
| `/context <symbols>` | Token-budgeted context extraction |
| `/diff` | Semantic diff with blast radius |
