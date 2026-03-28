import type { SearchAdapter } from './types.js';
import type { QueryIR, SearchRecipe } from '../types.js';

/**
 * HTTP/API adapter — emits recipes for endpoint, route, and fetch queries.
 * Distinguishes between route DEFINITIONS and outbound API CALLS.
 */
export const httpAdapter: SearchAdapter = {
  id: 'http',

  detect(ir: QueryIR): SearchRecipe[] {
    if (!ir.traits.routeLike) return [];

    const recipes: SearchRecipe[] = [];
    const isDefinitionQuery = ir.nlTokens.some((t) => ['endpoint', 'route', 'handler', 'defined', 'registered'].includes(t));
    const isCallQuery = ir.nlTokens.some((t) => ['fetch', 'request', 'http', 'call', 'calls'].includes(t));

    // Route/endpoint DEFINITION queries — server-side handler registration
    if (isDefinitionQuery) {
      recipes.push({
        id: 'http.route-definition',
        adapter: 'http',
        retrievers: ['behavior', 'regex', 'config'],
        regexes: [
          // Express/Fastify/Koa-style route registration
          { id: 'express-route', pattern: '(?:app|router)\\.(get|post|put|delete|patch|use)\\s*\\(', flags: 'gi' },
          // Next.js API route handlers
          { id: 'next-api-handler', pattern: 'export\\s+(?:default\\s+)?(?:async\\s+)?function\\s+(?:GET|POST|PUT|DELETE|PATCH|handler)', flags: 'g' },
          // Route config objects
          { id: 'route-config', pattern: '(?:routes|endpoints)\\s*[:=]\\s*[\\[{]', flags: 'gi' },
        ],
        scoreBoost: 3,
        reasons: ['HTTP adapter: route/endpoint definition query'],
      });
    }

    // Outbound API CALL queries — client-side fetch/request
    if (isCallQuery && !isDefinitionQuery) {
      recipes.push({
        id: 'http.api-call',
        adapter: 'http',
        retrievers: ['behavior', 'regex'],
        regexes: [
          { id: 'fetch-call', pattern: '(?:fetch|axios|request)\\s*\\(', flags: 'g' },
          { id: 'http-method', pattern: '\\.(get|post|put|delete|patch)\\s*\\(', flags: 'g' },
        ],
        scoreBoost: 1,
        reasons: ['HTTP adapter: outbound API call query'],
      });
    }

    // Ambiguous — both definition and call traits
    if (!isDefinitionQuery && !isCallQuery) {
      recipes.push({
        id: 'http.general',
        adapter: 'http',
        retrievers: ['behavior', 'config'],
        scoreBoost: 1,
        reasons: ['HTTP adapter: general route/API query'],
      });
    }

    return recipes;
  },
};
