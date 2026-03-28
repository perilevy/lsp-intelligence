import type { SearchAdapter } from './types.js';
import type { QueryIR, SearchRecipe } from '../types.js';

const HOOK_PATTERN = /^use[A-Z]/;

/**
 * React adapter — emits search recipes for React hook/component queries.
 *
 * Recipes:
 * - react.useeffect.conditional-cleanup
 * - react.useeffect.functional-state-updater
 * - react.usememo.computation
 * - react.usecallback.memoized-handler
 * - react.hook.general (fallback for any hook query)
 */
export const reactAdapter: SearchAdapter = {
  id: 'react',

  detect(ir: QueryIR): SearchRecipe[] {
    if (!ir.traits.reactLike) return [];

    const recipes: SearchRecipe[] = [];
    const hookIds = ir.exactIdentifiers.filter((id) => HOOK_PATTERN.test(id));
    const hasUseEffect = hookIds.includes('useEffect');
    const hasUseMemo = hookIds.includes('useMemo');
    const hasUseCallback = hookIds.includes('useCallback');

    // useEffect + conditional cleanup
    if (hasUseEffect && (
      ir.structuralPredicates.includes('conditional') ||
      ir.structuralPredicates.includes('returns-cleanup') ||
      ir.codeTokens.includes('cleanup')
    )) {
      recipes.push({
        id: 'react.useeffect.conditional-cleanup',
        adapter: 'react',
        retrievers: ['identifier', 'structural', 'regex'],
        exactIdentifiers: ['useEffect'],
        structuralPredicates: ['returns-cleanup', 'conditional'],
        regexes: [
          { id: 'conditional-return', pattern: 'if\\s*\\([^)]*\\)\\s*\\{[^}]*return\\s*\\(\\)', flags: 'g' },
          { id: 'useeffect-cleanup', pattern: 'useEffect\\s*\\(\\s*\\(\\)\\s*=>\\s*\\{[\\s\\S]*?return\\s', flags: 'g' },
        ],
        scoreBoost: 3,
        reasons: ['React adapter: useEffect + conditional cleanup pattern'],
      });
    }

    // useEffect + functional state updater (based on previous state)
    if (hasUseEffect && ir.traits.previousStateLike) {
      recipes.push({
        id: 'react.useeffect.functional-state-updater',
        adapter: 'react',
        retrievers: ['identifier', 'structural', 'regex'],
        exactIdentifiers: ['useEffect'],
        structuralPredicates: ['functional-state-updater'],
        regexes: [
          { id: 'functional-updater', pattern: 'set\\w+\\s*\\(\\s*(?:prev|current|existing|old)\\w*\\s*=>', flags: 'g' },
          { id: 'updater-arrow', pattern: 'set\\w+\\s*\\(\\s*\\w+\\s*=>\\s*\\w+', flags: 'g' },
        ],
        scoreBoost: 4,
        reasons: ['React adapter: useEffect + functional state updater'],
      });
    }

    // useMemo computation
    if (hasUseMemo) {
      recipes.push({
        id: 'react.usememo.computation',
        adapter: 'react',
        retrievers: ['identifier'],
        exactIdentifiers: ['useMemo'],
        scoreBoost: 1,
        reasons: ['React adapter: useMemo computation'],
      });
    }

    // useCallback memoized handler
    if (hasUseCallback) {
      recipes.push({
        id: 'react.usecallback.memoized-handler',
        adapter: 'react',
        retrievers: ['identifier'],
        exactIdentifiers: ['useCallback'],
        scoreBoost: 1,
        reasons: ['React adapter: useCallback memoized handler'],
      });
    }

    // General hook query (fallback)
    if (hookIds.length > 0 && recipes.length === 0) {
      recipes.push({
        id: 'react.hook.general',
        adapter: 'react',
        retrievers: ['identifier'],
        exactIdentifiers: hookIds,
        scoreBoost: 0,
        reasons: [`React adapter: general hook query for ${hookIds.join(', ')}`],
      });
    }

    return recipes;
  },
};
