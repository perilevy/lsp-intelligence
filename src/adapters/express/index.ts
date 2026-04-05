import type { QueryIR, SearchRecipe } from '../../search/types.js';
import type { IntelligenceAdapter } from '../types.js';

/**
 * Express/Fastify IntelligenceAdapter v2.
 *
 * Capabilities:
 * - detect: route definition queries
 * - graph.denylist: Express framework functions not useful as implementation roots
 */
export const expressAdapter: IntelligenceAdapter = {
  id: 'express',

  detect(ir: QueryIR): SearchRecipe[] {
    if (!ir.traits.routeLike) return [];

    const nlTokens = ir.nlTokens;
    const recipes: SearchRecipe[] = [];

    const isRouteDef = nlTokens.some(t =>
      ['route', 'endpoint', 'handler', 'defined', 'registered', 'handled'].includes(t),
    ) || ir.phrases.some(p => p.includes('is handled') || p.includes('is defined'));

    if (isRouteDef) {
      recipes.push({
        id: 'express.route-definition',
        adapter: 'express',
        retrievers: ['route', 'behavior', 'regex'],
        exactIdentifiers: [],
        regexes: [
          { id: 'express-route', pattern: '(?:app|router)\\.(?:get|post|put|delete|patch|all|use)\\s*\\(', flags: 'gi' },
          { id: 'fastify-route', pattern: 'fastify\\.(?:get|post|put|delete|patch)\\s*\\(', flags: 'g' },
          { id: 'route-config', pattern: '(?:routes|endpoints)\\s*[:=]\\s*[\\[{]', flags: 'gi' },
        ],
        scoreBoost: 3,
        reasons: ['Express adapter: route definition pattern'],
      });
    }

    return recipes;
  },

  graph: {
    denylist: [
      // Express framework — not real implementation roots
      'Router', 'express', 'use', 'listen', 'set',
      'json', 'urlencoded', 'static', 'raw', 'text',
      'next',    // Express next() middleware callback
      // Common Express middleware names
      'cors', 'helmet', 'morgan', 'compression',
      // Fastify framework
      'fastify', 'register', 'addHook', 'addPlugin',
    ],
  },
};
