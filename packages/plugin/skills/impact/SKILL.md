---
name: impact
description: Trace the blast radius of changing a symbol — find every file, reference, and affected test
argument-hint: <symbol-name> [--depth <number>]
---

# Impact Analysis

Analyze the full impact of changing the symbol the user specified.

## Steps

1. Run `impact_trace` with the user's symbol name. If the user passed `--depth <number>`, use that as `max_depth`; otherwise default to 3. If it returns no results, run `workspace_symbols` with the same query to suggest similar names — the user may have a typo or the symbol may live in a non-TS file.
2. Run `find_test_files` with the same symbol to identify tests that need updating
3. Present a summary:
   - **Severity**: LOW (< 5 refs), MEDIUM (5-20 refs), HIGH (> 20 refs)
   - **Direct references**: files that import/call the symbol directly
   - **Transitive references**: files affected through type aliases or re-exports
   - **Affected tests**: test/spec/stories files that reference the symbol
4. If severity is HIGH, suggest running `gather_context` on the most affected files before proceeding
5. If the user wants to continue, offer to run `outline` on the files they'll need to modify
