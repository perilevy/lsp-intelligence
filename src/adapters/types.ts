import type { QueryIR, SearchRecipe } from '../search/types.js';

/**
 * Phase 2E — IntelligenceAdapter v2 interface.
 *
 * Replaces the narrow SearchAdapter (search-recipe-only) with a composable
 * adapter that can contribute to every layer of the engine:
 * search, graph, explain, guard, verify.
 *
 * Migration policy:
 * When an adapter contributes at least one non-recipe capability (e.g. graph.denylist),
 * the corresponding old src/search/adapters/* file must be reduced to a thin
 * re-export within one sprint.
 */
export interface IntelligenceAdapter {
  readonly id: string;

  // ---------------------------------------------------------------------------
  // Search — query routing and recipe emission (migrated from SearchAdapter)
  // ---------------------------------------------------------------------------

  /**
   * Emit search recipes for queries that match this adapter's domain.
   * Equivalent to the old SearchAdapter.detect().
   */
  detect?(ir: QueryIR): SearchRecipe[];

  /**
   * Contribute additional IR enrichment beyond what the query parser produces.
   * Useful for framework-specific token classification.
   */
  enrichQuery?(ir: QueryIR): AdapterQueryContribution;

  // ---------------------------------------------------------------------------
  // Graph — implementation-root expansion intelligence
  // ---------------------------------------------------------------------------

  graph?: {
    /**
     * Symbols that should NEVER be promoted as implementation roots.
     * The engine skips these during graph expansion.
     * React: memo, forwardRef, createContext, etc.
     * Express: Router, app.use, etc.
     */
    denylist?: string[];

    /**
     * Symbol name patterns that ARE likely real implementation roots for this domain.
     * Used to boost candidates during graph expansion.
     */
    rootHints?: string[];
  };

  // ---------------------------------------------------------------------------
  // Explain — root cause trace hints
  // ---------------------------------------------------------------------------

  explain?: {
    /**
     * Hints that help root_cause_trace identify likely cause categories
     * for framework-specific error patterns.
     */
    causeHints?: AdapterCauseHint[];
  };

  // ---------------------------------------------------------------------------
  // Guard — API contract rules specific to this framework
  // ---------------------------------------------------------------------------

  guard?: {
    /**
     * Extra rules that api_guard applies when checking contracts.
     * E.g. React: prop type changes are always consumer-breaking.
     */
    rules?: AdapterGuardRule[];
  };

  // ---------------------------------------------------------------------------
  // Verify — framework-specific checks for verify_changes
  // ---------------------------------------------------------------------------

  verify?: {
    /**
     * Checks that verify_changes runs for this framework's idioms.
     * E.g. React: no conditional hooks, exhaustive useEffect deps.
     */
    checks?: AdapterVerifyCheck[];
  };
}

// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

export interface AdapterQueryContribution {
  /** Additional exact identifiers to include */
  extraIdentifiers?: string[];
  /** Additional behavior terms to score against */
  extraBehaviorTerms?: string[];
  /** Additional config terms for config/env retrieval */
  extraConfigTerms?: string[];
}

export interface AdapterCauseHint {
  /** TypeScript diagnostic code this hint applies to (e.g. '2345') */
  matchCode?: string;
  /** Pattern matched against the diagnostic message */
  matchMessage?: RegExp;
  /** Short human-readable category label */
  causeCategory: string;
  /** Actionable hint for the developer */
  hint: string;
  /** Score boost applied to candidates matching this hint */
  scoreBoost: number;
}

export interface AdapterGuardRule {
  id: string;
  description: string;
}

export interface AdapterVerifyCheck {
  id: string;
  description: string;
  /** Run the check and return issues found */
  run(filePaths: string[]): AdapterVerifyIssue[];
}

export interface AdapterVerifyIssue {
  filePath: string;
  line?: number;
  message: string;
  severity: 'error' | 'warning';
}
