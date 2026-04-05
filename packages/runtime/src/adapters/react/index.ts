import type { QueryIR, SearchRecipe } from '../../search/types.js';
import type { IntelligenceAdapter, AdapterCauseHint } from '../types.js';

const HOOK_PATTERN = /^use[A-Z]/;

/**
 * React IntelligenceAdapter v2.
 *
 * Capabilities beyond the old SearchAdapter:
 * - graph.denylist: React built-ins and HOC wrappers that should never be
 *   promoted as implementation roots during graph expansion
 * - graph.rootHints: patterns indicating actual component implementations
 * - explain.causeHints: React-specific root cause patterns
 */
export const reactAdapter: IntelligenceAdapter = {
  id: 'react',

  // ---------------------------------------------------------------------------
  // Search recipes (migrated from src/search/adapters/react.ts)
  // ---------------------------------------------------------------------------

  detect(ir: QueryIR): SearchRecipe[] {
    if (!ir.traits.reactLike) return [];

    const recipes: SearchRecipe[] = [];
    const hookIds = ir.exactIdentifiers.filter((id) => HOOK_PATTERN.test(id));
    const hasUseEffect = hookIds.includes('useEffect');
    const hasUseMemo = hookIds.includes('useMemo');
    const hasUseCallback = hookIds.includes('useCallback');

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

  // ---------------------------------------------------------------------------
  // Phase 2E: Graph intelligence — prevents React built-ins from appearing
  // as implementation roots when users ask "what is the real implementation?"
  // ---------------------------------------------------------------------------

  graph: {
    denylist: [
      // React core hooks
      'useState', 'useEffect', 'useMemo', 'useCallback', 'useRef', 'useContext',
      'useReducer', 'useLayoutEffect', 'useImperativeHandle', 'useDebugValue',
      'useTransition', 'useDeferredValue', 'useId', 'useSyncExternalStore',
      // React component wrappers — not "real" implementations
      'memo', 'forwardRef', 'lazy', 'Suspense',
      // React factory functions
      'createElement', 'createContext', 'createRef', 'createPortal',
      'cloneElement', 'isValidElement', 'Children',
      // React Router / Next.js HOCs
      'withRouter', 'connect', 'inject',
    ],

    rootHints: [
      // Functions named after common React patterns are often real implementations
      // (used to boost these during graph expansion)
    ],
  },

  // ---------------------------------------------------------------------------
  // Phase 2E: Explain hints — React-specific root cause patterns
  // ---------------------------------------------------------------------------

  explain: {
    causeHints: [
      {
        matchCode: '2345',
        matchMessage: /props/i,
        causeCategory: 'react-prop-type-mismatch',
        hint: 'Check that the component\'s prop type interface matches what is being passed',
        scoreBoost: 2,
      },
      {
        matchCode: '2339',
        matchMessage: /useEffect|useState|useMemo/i,
        causeCategory: 'react-hook-return',
        hint: 'The hook may not return what you expect — check the hook\'s return type definition',
        scoreBoost: 2,
      },
    ] satisfies AdapterCauseHint[],
  },
};
