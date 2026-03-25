import type { BehaviorFamily } from './types.js';

export const BEHAVIOR_FAMILIES: BehaviorFamily[] = [
  {
    id: 'auth_permission',
    triggerTerms: ['permission', 'auth', 'authorize', 'role', 'guard', 'access'],
    synonyms: ['can', 'allow', 'deny', 'policy', 'privilege', 'acl'],
    fileHints: ['auth', 'permission', 'guard', 'access', 'policy', 'acl'],
    symbolHints: ['auth', 'permission', 'guard', 'authorize', 'can', 'allow'],
    astPatterns: [
      'function $F($$$): boolean { $$$ }',
      'function $F($$$): Promise<boolean> { $$$ }',
    ],
    scoreBoosts: { pathHint: 4, symbolHint: 5, astMatch: 6, exported: 2 },
  },
  {
    id: 'validation',
    triggerTerms: ['valid', 'check', 'verify', 'assert', 'sanitize'],
    synonyms: ['parse', 'conform', 'ensure', 'require', 'constraint'],
    fileHints: ['valid', 'check', 'verify', 'assert', 'sanitize', 'schema'],
    symbolHints: ['valid', 'check', 'verify', 'assert', 'is', 'has'],
    astPatterns: [
      'function $F($$$): boolean { $$$ }',
      '$$.validate($$$)',
      '$$.parse($$$)',
    ],
    scoreBoosts: { pathHint: 4, symbolHint: 5, astMatch: 5, exported: 2 },
  },
  {
    id: 'error_handling',
    triggerTerms: ['error', 'catch', 'handle', 'recover', 'retry', 'fallback'],
    synonyms: ['fail', 'exception', 'throw', 'boundary', 'sentinel'],
    fileHints: ['error', 'handler', 'boundary', 'fallback', 'recovery'],
    symbolHints: ['error', 'handle', 'catch', 'recover', 'retry', 'fallback'],
    astPatterns: [
      'try { $$$ } catch ($E) { $$$ }',
      'function $F($$$) { try { $$$ } catch ($E) { $$$ } }',
    ],
    scoreBoosts: { pathHint: 3, symbolHint: 4, astMatch: 5, exported: 2 },
  },
  {
    id: 'fetching',
    triggerTerms: ['fetch', 'load', 'query', 'request', 'api', 'endpoint'],
    synonyms: ['get', 'post', 'call', 'invoke', 'http', 'ajax', 'download'],
    fileHints: ['api', 'fetch', 'service', 'client', 'endpoint', 'request'],
    symbolHints: ['fetch', 'load', 'get', 'query', 'request', 'api', 'create'],
    astPatterns: [
      'async function $F($$$) { $$$ await $$$ }',
      'function $F($$$): Promise<$T> { $$$ }',
    ],
    scoreBoosts: { pathHint: 4, symbolHint: 4, astMatch: 4, exported: 2 },
  },
  {
    id: 'state_management',
    triggerTerms: ['state', 'store', 'dispatch', 'reducer', 'slice', 'redux'],
    synonyms: ['action', 'thunk', 'selector', 'middleware', 'subscribe'],
    fileHints: ['store', 'reducer', 'slice', 'duck', 'state', 'redux'],
    symbolHints: ['reducer', 'slice', 'dispatch', 'selector', 'use', 'thunk'],
    astPatterns: [
      'createSlice($$$)',
      'useSelector($$$)',
      'useDispatch($$$)',
    ],
    scoreBoosts: { pathHint: 4, symbolHint: 5, astMatch: 6, exported: 2 },
  },
  {
    id: 'feature_flags',
    triggerTerms: ['feature', 'flag', 'toggle', 'gate', 'experiment', 'launch'],
    synonyms: ['switch', 'variant', 'rollout', 'canary', 'dark'],
    fileHints: ['feature', 'flag', 'toggle', 'gate', 'experiment'],
    symbolHints: ['feature', 'flag', 'toggle', 'gate', 'enabled', 'variant'],
    astPatterns: [
      'useFeatureFlag($$$)',
      'if ($$.isEnabled($$$)) { $$$ }',
    ],
    scoreBoosts: { pathHint: 4, symbolHint: 5, astMatch: 6, exported: 2 },
  },
  {
    id: 'retry_backoff',
    triggerTerms: ['retry', 'backoff', 'debounce', 'throttle', 'rate', 'limit'],
    synonyms: ['exponential', 'delay', 'cooldown', 'timeout', 'interval'],
    fileHints: ['retry', 'backoff', 'throttle', 'debounce', 'rate'],
    symbolHints: ['retry', 'backoff', 'debounce', 'throttle', 'delay', 'wait'],
    astPatterns: [
      'setTimeout($$$)',
      'setInterval($$$)',
    ],
    scoreBoosts: { pathHint: 4, symbolHint: 4, astMatch: 3, exported: 2 },
  },
  {
    id: 'caching',
    triggerTerms: ['cache', 'memo', 'memoize', 'store', 'persist', 'ttl'],
    synonyms: ['lru', 'invalidate', 'expire', 'warm', 'preload', 'stale'],
    fileHints: ['cache', 'memo', 'store', 'persist', 'storage'],
    symbolHints: ['cache', 'memo', 'memoize', 'persist', 'store', 'get', 'set'],
    astPatterns: [
      'useMemo($$$)',
      'useCallback($$$)',
      '$$.get($KEY)',
    ],
    scoreBoosts: { pathHint: 3, symbolHint: 4, astMatch: 3, exported: 2 },
  },
];
