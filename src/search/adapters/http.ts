/**
 * Phase 2E migration cutover: thin compatibility wrapper.
 *
 * HTTP/route detection has been distributed across:
 * - src/adapters/next/index.ts  (Next.js route patterns)
 * - src/adapters/express/index.ts  (Express/Fastify route patterns)
 *
 * The httpAdapter is kept here for backward compatibility with any code
 * that still imports it from this path. It delegates to the v2 adapters.
 */
import type { SearchAdapter } from './types.js';
import type { QueryIR, SearchRecipe } from '../types.js';
import { nextAdapter } from '../../adapters/next/index.js';
import { expressAdapter } from '../../adapters/express/index.js';

export const httpAdapter: SearchAdapter = {
  id: 'http',
  detect(ir: QueryIR): SearchRecipe[] {
    // Combine Next.js and Express route detection recipes
    return [
      ...(nextAdapter.detect?.(ir) ?? []),
      ...(expressAdapter.detect?.(ir) ?? []),
    ];
  },
};
