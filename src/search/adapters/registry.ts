/**
 * Phase 2E migration cutover: this file is now a thin compatibility shim.
 *
 * The real adapter registry has moved to src/adapters/registry.ts.
 * All new code should import from there directly.
 *
 * This file is kept for any remaining consumers that import from the old path.
 */
export { runAdapters } from '../../adapters/registry.js';
