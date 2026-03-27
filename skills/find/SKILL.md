---
name: find
description: Search code by natural language — finds implementations, API usage, structural patterns, and likely roots
argument-hint: <query>
---

# Code Search

Find code using natural language. Automatically routes to the right search backend — behavior discovery, identifier/API usage, or structural queries.

## Steps

1. Parse the user's query:
   - If the user provided a query argument, use it directly
   - Otherwise, ask what they're looking for

2. Call `find_code` with the query:
   - Let mode default to `auto` — the tool routes automatically
   - If the user mentioned a specific directory or package, pass it in `paths`
   - If the user wants test files included, set `include_tests: true`

3. Interpret the results based on confidence:

   **High confidence** (strong matches from multiple sources):
   - Show the top 3 candidates with file path, symbol name, and why it matched
   - For the #1 candidate, show the snippet
   - If it's a usage site, mention the enclosing function/component

   **Medium confidence** (reasonable matches, single source):
   - Show top 3 candidates with evidence
   - Suggest the user refine their query or try a more specific term
   - Offer to run `find_pattern` if the query has a structural shape

   **Low confidence** (weak or no matches):
   - Explain what was searched and why it didn't match well
   - Suggest alternative queries based on the IR (e.g., "try searching for the exact function name")
   - Offer to try `find_pattern` with an AST pattern instead

4. Offer follow-up actions:
   - "Want me to read the top result?" → Read the file
   - "Want more context?" → Call `gather_context` on the top candidate's symbol
   - "What calls this?" → Call `call_hierarchy` on the symbol
   - "What breaks if I change this?" → Call `impact_trace` on the symbol

## Examples

**Identifier search**: `/find useEffect` — finds all useEffect call sites
**Structural**: `/find useEffect that returns cleanup conditionally` — finds useEffect calls with conditional cleanup
**Behavior**: `/find where do we validate permissions` — finds permission validation entrypoints
**Scoped**: `/find retry logic` in packages/core — searches only in core
