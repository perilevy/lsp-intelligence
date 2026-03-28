import type { SearchAdapter } from './types.js';
import type { QueryIR, SearchRecipe } from '../types.js';

/**
 * HTTP/API adapter — emits recipes for endpoint, route, and fetch queries.
 */
export const httpAdapter: SearchAdapter = {
  id: 'http',

  detect(ir: QueryIR): SearchRecipe[] {
    if (!ir.traits.routeLike) return [];

    const recipes: SearchRecipe[] = [];

    // Route/endpoint definition queries
    if (ir.nlTokens.some((t) => ['endpoint', 'route', 'handler', 'api'].includes(t))) {
      recipes.push({
        id: 'http.route-definition',
        adapter: 'http',
        retrievers: ['behavior', 'regex', 'config'],
        regexes: [
          { id: 'express-route', pattern: '(?:app|router)\\.(get|post|put|delete|patch|use)\\s*\\(', flags: 'gi' },
          { id: 'next-api-handler', pattern: 'export\\s+(?:default\\s+)?(?:async\\s+)?function\\s+(?:GET|POST|PUT|DELETE|PATCH|handler)', flags: 'g' },
          { id: 'fetch-url', pattern: 'fetch\\s*\\(\\s*[\'"`]\\/', flags: 'g' },
        ],
        scoreBoost: 2,
        reasons: ['HTTP adapter: route/endpoint definition query'],
      });
    }

    // API call/fetch queries
    if (ir.nlTokens.some((t) => ['fetch', 'request', 'http', 'call'].includes(t))) {
      recipes.push({
        id: 'http.api-call',
        adapter: 'http',
        retrievers: ['behavior', 'regex'],
        regexes: [
          { id: 'fetch-call', pattern: '(?:fetch|axios|request)\\s*\\(', flags: 'g' },
          { id: 'http-method', pattern: '\\.(get|post|put|delete|patch)\\s*\\(', flags: 'g' },
        ],
        scoreBoost: 1,
        reasons: ['HTTP adapter: API call/fetch query'],
      });
    }

    return recipes;
  },
};
