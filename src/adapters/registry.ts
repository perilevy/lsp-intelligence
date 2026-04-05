import type { QueryIR, SearchRecipe } from '../search/types.js';
import type { IntelligenceAdapter, AdapterCauseHint } from './types.js';
import { reactAdapter } from './react/index.js';
import { nextAdapter } from './next/index.js';
import { expressAdapter } from './express/index.js';
// Config adapter remains in search/adapters until Phase 4 — wrapped here for compatibility
import { configAdapter as legacyConfigAdapter } from '../search/adapters/config.js';

/**
 * Phase 2E — Central IntelligenceAdapter registry.
 *
 * This is the single source of truth for all adapter capabilities.
 * The old src/search/adapters/registry.ts delegates here for backward compatibility.
 */

// Wrap the legacy configAdapter as an IntelligenceAdapter for inclusion
const configAdapterCompat: IntelligenceAdapter = {
  id: 'config',
  detect: (ir) => legacyConfigAdapter.detect(ir),
};

const ADAPTERS: IntelligenceAdapter[] = [
  reactAdapter,
  nextAdapter,
  expressAdapter,
  configAdapterCompat,
];

// ---------------------------------------------------------------------------
// Search recipes (backward-compatible with old SearchAdapter.detect())
// ---------------------------------------------------------------------------

/** Run all adapter detect() methods and return merged search recipes. */
export function runAdapters(ir: QueryIR): SearchRecipe[] {
  const recipes: SearchRecipe[] = [];
  for (const adapter of ADAPTERS) {
    if (adapter.detect) {
      recipes.push(...adapter.detect(ir));
    }
  }
  return recipes;
}

// ---------------------------------------------------------------------------
// Graph intelligence
// ---------------------------------------------------------------------------

/** Get the merged denylist from all adapters. */
export function getAdapterGraphDenylist(): Set<string> {
  const merged = new Set<string>();
  for (const adapter of ADAPTERS) {
    for (const symbol of adapter.graph?.denylist ?? []) {
      merged.add(symbol);
    }
  }
  return merged;
}

/** Get all root hints from all adapters. */
export function getAdapterRootHints(): string[] {
  return ADAPTERS.flatMap((a) => a.graph?.rootHints ?? []);
}

// ---------------------------------------------------------------------------
// Explain intelligence
// ---------------------------------------------------------------------------

/** Get all cause hints from all adapters. */
export function getAdapterCauseHints(): AdapterCauseHint[] {
  return ADAPTERS.flatMap((a) => a.explain?.causeHints ?? []);
}

/**
 * Find the best cause hint for a given diagnostic code + message.
 * Returns the highest-scoring matching hint, or null if none match.
 */
export function matchCauseHint(code: string | undefined, message: string): AdapterCauseHint | null {
  const candidates = getAdapterCauseHints().filter((h) => {
    if (h.matchCode && code !== h.matchCode) return false;
    if (h.matchMessage && !h.matchMessage.test(message)) return false;
    return true;
  });
  if (candidates.length === 0) return null;
  return candidates.reduce((best, c) => c.scoreBoost > best.scoreBoost ? c : best);
}

// ---------------------------------------------------------------------------
// Verify checks
// ---------------------------------------------------------------------------

/** Run all adapter verify checks on the given files. */
export function runAdapterVerifyChecks(filePaths: string[]): Array<{ adapterId: string; issues: ReturnType<NonNullable<NonNullable<IntelligenceAdapter['verify']>['checks']>[number]['run']> }> {
  const results = [];
  for (const adapter of ADAPTERS) {
    for (const check of adapter.verify?.checks ?? []) {
      const issues = check.run(filePaths);
      if (issues.length > 0) {
        results.push({ adapterId: adapter.id, issues });
      }
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Adapter access
// ---------------------------------------------------------------------------

export function getAdapter(id: string): IntelligenceAdapter | undefined {
  return ADAPTERS.find((a) => a.id === id);
}

export function getAllAdapters(): readonly IntelligenceAdapter[] {
  return ADAPTERS;
}
