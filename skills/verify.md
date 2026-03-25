---
name: verify
description: Run full verification on recent changes — type check + API guard + test coverage
argument-hint: [--base <branch>]
---

# Verify Changes

Full pre-commit/pre-PR verification. Combines type checking, API contract analysis, and test coverage.

## Steps

1. Run `semantic_diff` to identify what symbols changed
   - If `--base <branch>` specified, use that; otherwise auto-detect

2. For each changed file with TypeScript source:
   - Run `live_diagnostics` to check for type errors
   - If errors found, run `explain_error` for each

3. If any changed files contain exports:
   - Run `api_guard` to check for breaking API changes
   - Report semver impact

4. For high-risk changed symbols (>10 references):
   - Run `find_test_files` to check test coverage
   - Flag untested high-risk changes

5. Summarize:
   - **Type errors**: count and locations
   - **API changes**: breaking/risky/safe with semver
   - **Test gaps**: changed symbols without test coverage
   - **Verdict**: "safe to merge" or "needs attention"
