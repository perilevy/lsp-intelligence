---
name: verify
description: Full pre-merge verification — diagnostics, API contract, test coverage, verdict
argument-hint: [--base <branch>]
---

# Verify Changes

Full pre-commit/pre-PR verification in one command. Orchestrates diagnostics, API contract analysis, and test coverage into a single structured verdict.

## Steps

1. Call `verify_changes` with the user's base branch (if specified):
   - If `--base <branch>` provided, pass it
   - Otherwise, let the tool auto-detect the merge base

2. Present the result in this order:

   **Changed files** — list what was modified

   **Type errors** — if `totalErrors > 0`:
   - Show each file with its error count
   - Show the first 3 errors per file with line and message
   - Offer to run `/why` on the first error for root cause

   **API changes** — if `api` is not null:
   - Show semver verdict: MAJOR / MINOR / PATCH
   - If breaking > 0: list breaking changes with details
   - If risky > 0: list risky changes
   - Offer to run `/api-check` for full details

   **Test gaps** — if any `testGaps` have `hasTests: false`:
   - List untested high-risk symbols with reference counts
   - Offer to run `/impact <symbol>` for blast radius

   **Verdict** — show the final verdict prominently:
   - "safe to merge" — all clear
   - "needs attention" — breaking API changes or untested high-risk symbols
   - "has errors" — type errors must be fixed first

3. If there are warnings, show them at the bottom.

4. Offer follow-up actions based on verdict:
   - **has errors**: "Want me to fix the errors?" or `/why <file:line>`
   - **needs attention**: "Want me to check the breaking changes?" or `/api-check`
   - **safe to merge**: "Ready to commit?" or `/diff` to review

## Examples

| Command | What happens |
|---------|-------------|
| `/verify` | Auto-detect base, check all changed files |
| `/verify --base main` | Compare against main branch |
| `/verify --base develop` | Compare against develop branch |
