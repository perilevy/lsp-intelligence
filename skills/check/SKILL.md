---
name: check
description: Run type checking on files — catch errors immediately after edits
argument-hint: [file-path ...]
---

# Type Check

Check for type errors after edits and explain any issues found.

## Steps

1. Determine which files to check:
   - If the user specified file paths, use those
   - Otherwise, run `git diff --name-only` in the workspace to find changed TypeScript files
   - If no git changes found, ask the user which files to check
2. Run `live_diagnostics` on each file
3. For each file:
   - If clean: report "no errors"
   - If errors found: run `explain_error` on each error location to get actionable context
4. Present a summary:
   - **Clean files**: list them briefly
   - **Files with errors**: show each error with the explanation and suggested fix
   - **Total**: "X files checked, Y errors found"
5. If errors were found, offer to fix them
