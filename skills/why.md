---
name: why
description: Trace the root cause of a TypeScript error — find what declaration change actually broke it
argument-hint: <file:line> or <file>
---

# Root Cause Trace

Trace the root cause of a TypeScript error. Don't just fix the symptom — find what changed upstream.

## Steps

1. Parse the user's input:
   - If `file:line` format: use both
   - If just a file: let the tool find the first error
   - If no input: check files edited in the current conversation for errors

2. Run `root_cause_trace` with the file path and optional line

3. Present the result:
   - **The error**: what diagnostic, where
   - **The root cause**: which declaration changed and why it caused this
   - **Evidence chain**: definition → change → impact
   - **Suggested fix**: if the tool provides one
   - **Other candidates**: if the top result has low confidence

4. If confidence is low, suggest:
   - Running `/check` on related files to find more errors
   - Running `/impact` on the suspected symbol to see full blast radius

5. If the user wants to fix it, use `gather_context` on the root cause file to get the relevant code
