---
name: context
description: Gather token-budgeted context for a coding task — only the code you need, nothing you don't
argument-hint: <symbol-name or task description> [--tokens <number>]
---

# Gather Context

Build a minimal, complete context for the task the user described.

## Steps

1. Identify entry symbols:
   - If the user provided a symbol name, use it directly
   - If the user described a task (e.g. "add a new status type"), extract likely symbol names from the description and use `workspace_symbols` to resolve them
2. Run `gather_context` with the entry symbols. Set `max_tokens`:
   - If the user passed `--tokens <number>`, use that value
   - Otherwise, consider your remaining context window — the default is 100k but reduce it if the conversation is already long
3. Present the result to the user organized as:
   - **Must modify**: files with full code bodies — these need changes
   - **Verify only**: files shown as signatures — check these still work after changes
   - **Skip**: files listed by name — update these later (usually tests)
4. Ask the user: "Does this look right? Should I include more files or adjust the scope?"
5. If the user wants more detail on a specific file, run `outline` on it
