/**
 * Behavior families — redesigned with classifier/expansion split.
 *
 * classifierTerms: strong terms only. Weak words (use, get, set, call, run, make)
 * must NEVER appear here. These drive mode routing.
 *
 * expansionTerms: broader lexical expansion for recall. May include weaker terms.
 */

export interface BehaviorFamily {
  id: string;
  classifierTerms: string[];
  expansionTerms: string[];
  fileHints: string[];
  symbolHints: string[];
}

export const BEHAVIOR_FAMILIES: BehaviorFamily[] = [
  {
    id: 'auth_permission',
    classifierTerms: ['permission', 'auth', 'authorize', 'guard', 'access', 'role', 'acl'],
    expansionTerms: ['can', 'allow', 'deny', 'policy', 'privilege', 'protect', 'secure'],
    fileHints: ['auth', 'permission', 'guard', 'access', 'policy', 'acl'],
    symbolHints: ['permission', 'guard', 'authorize', 'protect', 'allow'],
  },
  {
    id: 'validation',
    classifierTerms: ['valid', 'validate', 'verify', 'assert', 'sanitize', 'schema'],
    expansionTerms: ['parse', 'conform', 'ensure', 'require', 'constraint', 'check'],
    fileHints: ['valid', 'verify', 'assert', 'sanitize', 'schema'],
    symbolHints: ['valid', 'verify', 'assert', 'schema'],
  },
  {
    id: 'error_handling',
    classifierTerms: ['error', 'exception', 'boundary', 'recover', 'fallback'],
    expansionTerms: ['fail', 'throw', 'sentinel', 'catch', 'handle'],
    fileHints: ['error', 'handler', 'boundary', 'fallback', 'recovery'],
    symbolHints: ['error', 'handle', 'recover', 'fallback', 'boundary'],
  },
  {
    id: 'fetching',
    classifierTerms: ['fetch', 'endpoint', 'api', 'request', 'http'],
    expansionTerms: ['load', 'query', 'download', 'post', 'ajax', 'invoke'],
    fileHints: ['api', 'fetch', 'service', 'client', 'endpoint', 'request'],
    symbolHints: ['fetch', 'api', 'endpoint', 'request', 'service'],
  },
  {
    id: 'state_management',
    classifierTerms: ['redux', 'store', 'reducer', 'slice', 'dispatch'],
    expansionTerms: ['action', 'thunk', 'selector', 'middleware', 'subscribe', 'state'],
    fileHints: ['store', 'reducer', 'slice', 'duck', 'redux'],
    symbolHints: ['reducer', 'slice', 'dispatch', 'selector', 'thunk'],
  },
  {
    id: 'feature_flags',
    classifierTerms: ['feature', 'flag', 'toggle', 'experiment', 'launch'],
    expansionTerms: ['switch', 'variant', 'rollout', 'canary', 'gate', 'dark'],
    fileHints: ['feature', 'flag', 'toggle', 'gate', 'experiment'],
    symbolHints: ['feature', 'flag', 'toggle', 'gate', 'enabled'],
  },
  {
    id: 'retry_backoff',
    classifierTerms: ['retry', 'backoff', 'debounce', 'throttle', 'ratelimit'],
    expansionTerms: ['exponential', 'delay', 'cooldown', 'timeout', 'interval', 'limit'],
    fileHints: ['retry', 'backoff', 'throttle', 'debounce', 'rate'],
    symbolHints: ['retry', 'backoff', 'debounce', 'throttle', 'delay'],
  },
  {
    id: 'caching',
    classifierTerms: ['cache', 'memoize', 'persist', 'ttl', 'lru'],
    expansionTerms: ['memo', 'invalidate', 'expire', 'warm', 'preload', 'stale', 'store'],
    fileHints: ['cache', 'memo', 'persist', 'storage'],
    symbolHints: ['cache', 'memo', 'memoize', 'persist'],
  },
];

/**
 * Score a set of tokens against all families.
 * Uses only classifierTerms for strong matching.
 * Returns per-family scores.
 */
export function scoreFamilies(tokens: string[]): Record<string, number> {
  const scores: Record<string, number> = {};

  for (const family of BEHAVIOR_FAMILIES) {
    let score = 0;
    for (const token of tokens) {
      // Classifier terms: strong match
      for (const ct of family.classifierTerms) {
        if (ct === token) score += 3;
        else if (ct.startsWith(token) || token.startsWith(ct)) score += 1;
      }
    }
    if (score > 0) scores[family.id] = score;
  }

  return scores;
}
