---
name: diff
description: Semantic diff — see what symbols changed and their blast radius before committing
argument-hint: [--base <branch>]
---

# Semantic Diff

Analyze the current branch's changes semantically — not just lines changed, but which symbols changed and what might break.

## Steps

1. Determine the base branch:
   - If the user passed `--base <branch>`, use it
   - Otherwise, try `git rev-parse --verify main` — if it exists, use `main`
   - If not, try `master`
   - If neither exists, ask the user for the base branch
   Run `semantic_diff` with the resolved base
2. For each changed symbol with risk 🔴 (HIGH — >10 references):
   - Run `find_test_files` to check if tests exist for it
   - If no tests: flag as "untested change — high risk"
3. Present results:
   - **High risk** (🔴): symbols with many references — review carefully
   - **Medium risk** (🟡): symbols with some references — verify
   - **Safe** (🟢): symbols with no external references — low risk
4. If any high-risk changes lack tests, suggest running `/impact` on those symbols
5. If everything looks clean, confirm: "Changes look safe to commit"
