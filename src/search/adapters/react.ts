/**
 * Phase 2E migration cutover: thin compatibility wrapper.
 *
 * The React adapter has moved to src/adapters/react/index.ts.
 * It now implements IntelligenceAdapter (v2) with graph.denylist intelligence
 * in addition to search recipes.
 *
 * Old consumers of this module still work via this re-export.
 */
import type { SearchAdapter } from './types.js';
import { reactAdapter as v2ReactAdapter } from '../../adapters/react/index.js';

/** Backward-compatible SearchAdapter wrapper around the v2 React adapter */
export const reactAdapter: SearchAdapter = {
  id: 'react',
  detect: (ir) => v2ReactAdapter.detect?.(ir) ?? [],
};
