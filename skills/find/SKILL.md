---
name: find
description: Search code by natural language — finds implementations, API usage, structural patterns, configs, and likely roots
argument-hint: <query>
---

# Code Search

Find code using natural language. Automatically routes to the right search backend.

## Steps

1. Parse the user's query:
   - If the user provided a query argument, use it directly
   - Otherwise, ask what they're looking for

2. Call `find_code` with the query:
   - Let focus default to `auto`
   - If the user mentioned a specific directory or package, pass it in `paths`
   - If the user wants test files included, set `include_tests: true`
   - If the user is debugging search quality, set `debug: true`

3. Interpret the results based on confidence:

   **High confidence** (strong matches from multiple sources):
   - Show the top 3 candidates with file path, symbol name, and why it matched
   - For the #1 candidate, show the snippet and enclosing function/component
   - If the result has graph evidence, mention what was promoted/demoted
   - Automatically call `gather_context` on the #1 candidate's symbol to provide ready-to-use context

   **Medium confidence** (reasonable matches, single source):
   - Show top 3 candidates with evidence
   - Suggest the user refine their query or try a more specific term
   - Offer to run `find_pattern` if the query has a structural shape
   - Note any warnings (scope capped, partial results)

   **Low confidence** (weak or no matches):
   - Explain what was searched and why it didn't match well
   - Check the IR: suggest using the exact function name if only NL tokens were used
   - Offer to try `find_pattern` with an AST pattern instead
   - If scope was capped, mention it and suggest narrowing with `paths`

4. Offer follow-up actions:
   - "Want me to read the top result?" → Read the file
   - "Want more context?" → Call `gather_context` on the top candidate's symbol
   - "What calls this?" → Call `call_hierarchy` on the symbol
   - "What breaks if I change this?" → Call `impact_trace` on the symbol
   - "Is the API safe?" → Call `api_guard` on the file

5. If `stats.partialResult` is true or `warnings` is non-empty, mention it clearly so the user knows the search was incomplete.

## Examples

| Query | What happens |
|-------|-------------|
| `/find useEffect` | Identifier search → all useEffect call sites |
| `/find useEffect that returns cleanup conditionally` | Structural → useEffect with conditional cleanup |
| `/find useEffect that sets state based on previous state` | React recipe → functional state updater pattern |
| `/find where do we validate permissions` | Behavior → permission validation entrypoints |
| `/find where is the feature flag configured` | Config → JSON/YAML/env entries |
| `/find where is this endpoint defined` | Route → route definitions + handler code |
| `/find switch without default` | Structural → switch statements missing default |
| `/find retry logic` in packages/core | Scoped behavior search |
