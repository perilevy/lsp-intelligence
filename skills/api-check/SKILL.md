---
name: api-check
description: Check for breaking API changes — what exports changed, who consumes them, and semver impact
argument-hint: [--base <branch>] [--scope changed|all]
---

# API Guard

Check the public API surface for breaking changes before merging.

## Steps

1. Parse the user's input:
   - If `--base <branch>`: use that as the comparison base
   - If `--scope all`: check all files, not just changed ones
   - Default: changed files only, base auto-detected from main/master

2. Run `api_guard` with the parsed arguments

3. Present the result:
   - **Semver verdict**: MAJOR (breaking), MINOR (additive), PATCH (internal)
   - **Breaking changes**: list with structural diffs and consumer counts
   - **Risky changes**: changes that might break consumers
   - **Safe changes**: additive or internal-only

4. For each breaking change, highlight:
   - What exactly changed (enum member added, param now required, etc.)
   - How many cross-package consumers are affected
   - Sample consumer files

5. If breaking changes exist:
   - Suggest running `/impact` on the most impactful symbol
   - Ask if the breaking change is intentional
   - Offer to run `/check` on consumer files to verify they compile
