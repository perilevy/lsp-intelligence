import type { SearchAdapter } from './types.js';
import type { QueryIR, SearchRecipe } from '../types.js';

/**
 * Config adapter — emits recipes for feature flag, env var, and config queries.
 */
export const configAdapter: SearchAdapter = {
  id: 'config',

  detect(ir: QueryIR): SearchRecipe[] {
    if (!ir.traits.configLike) return [];

    const recipes: SearchRecipe[] = [];

    // Feature flag queries
    if (ir.nlTokens.some((t) => ['flag', 'toggle', 'feature', 'experiment', 'gate'].includes(t))) {
      recipes.push({
        id: 'config.feature-flag',
        adapter: 'config',
        retrievers: ['config', 'regex', 'behavior'],
        regexes: [
          { id: 'feature-flag-def', pattern: '(?:feature|flag|toggle|gate|experiment)\\w*\\s*[:=]', flags: 'gi' },
          { id: 'launchdarkly', pattern: 'useFeatureFlag|useLDClient|ldClient|variation\\(', flags: 'g' },
          { id: 'feature-enum', pattern: 'FeatureFlag\\b|Feature\\w*Flag', flags: 'g' },
        ],
        scoreBoost: 2,
        reasons: ['Config adapter: feature flag query'],
      });
    }

    // Env var queries
    if (ir.nlTokens.some((t) => ['env', 'environment', 'variable', 'secret'].includes(t))) {
      recipes.push({
        id: 'config.env-var',
        adapter: 'config',
        retrievers: ['config', 'regex'],
        regexes: [
          { id: 'process-env', pattern: 'process\\.env\\.\\w+', flags: 'g' },
          { id: 'env-import', pattern: 'import\\.meta\\.env\\.\\w+', flags: 'g' },
          { id: 'dotenv', pattern: 'dotenv|loadEnv|env\\w*Config', flags: 'gi' },
        ],
        scoreBoost: 2,
        reasons: ['Config adapter: env variable query'],
      });
    }

    // General config queries
    if (recipes.length === 0) {
      recipes.push({
        id: 'config.general',
        adapter: 'config',
        retrievers: ['config', 'behavior'],
        regexes: [
          { id: 'config-object', pattern: '(?:config|settings|options)\\s*[:=]\\s*\\{', flags: 'gi' },
        ],
        scoreBoost: 1,
        reasons: ['Config adapter: general config query'],
      });
    }

    return recipes;
  },
};
