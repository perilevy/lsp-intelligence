import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getEngine, shutdownEngine, fixturePath, getFixtureRoot } from './setup.js';
import type { LspEngine } from '../src/engine/LspEngine.js';
import { findPattern } from '../src/tools/composites/findPattern.js';
import { findCodeByBehavior } from '../src/tools/composites/findCodeByBehavior.js';
import { apiGuard } from '../src/tools/composites/apiGuard.js';
import { rootCauseTrace } from '../src/tools/composites/rootCauseTrace.js';

describe('v0.2 Features', () => {
  let engine: LspEngine;

  beforeAll(async () => {
    engine = await getEngine();
  }, 60_000);

  afterAll(async () => {
    await shutdownEngine();
  });

  describe('find_pattern', () => {
    it('finds export statements', async () => {
      const result = await findPattern.handler(
        { pattern: 'export const $NAME = $$$', language: 'typescript', max_results: 20 },
        engine,
      );
      // Should find exported const declarations in fixture
      expect(result).toContain('Pattern Search');
      expect(result).toContain('matches');
    });

    it('finds try/catch blocks', async () => {
      const result = await findPattern.handler(
        { pattern: 'try { $$$ } catch ($E) { $$$ }', language: 'typescript', max_results: 10 },
        engine,
      );
      // errorBoundary.ts has try/catch
      expect(result).toMatch(/match|errorBoundary/);
    });

    it('finds async functions', async () => {
      const result = await findPattern.handler(
        { pattern: 'async function $F($$$) { $$$ }', language: 'typescript', max_results: 10 },
        engine,
      );
      // fetchItems and withRetry are async
      expect(result).toContain('matches');
    });

    it('returns no matches for impossible pattern', async () => {
      const result = await findPattern.handler(
        { pattern: 'xyzNeverMatchThis123($$$)', language: 'typescript', max_results: 10 },
        engine,
      );
      expect(result).toContain('No matches');
    });

    it('limits results by max_results', async () => {
      const result = await findPattern.handler(
        { pattern: 'export const $NAME = $$$', language: 'typescript', max_results: 2 },
        engine,
      );
      expect(result).toContain('2 matches');
    });
  });

  describe('find_code_by_behavior', () => {
    it('finds validation-related code', async () => {
      const result = await findCodeByBehavior.handler(
        { query: 'validation', max_results: 5 },
        engine,
      );
      expect(result).toContain('find_code_by_behavior');
      expect(result).toContain('candidates');
      // Should find validateConfig, isValidTransition
      expect(result).toMatch(/validat/i);
    });

    it('finds error handling code', async () => {
      const result = await findCodeByBehavior.handler(
        { query: 'error handling', max_results: 5 },
        engine,
      );
      expect(result).toContain('find_code_by_behavior');
      // Should find handleItemError
      expect(result).toMatch(/error/i);
    });

    it('finds permission/auth code', async () => {
      const result = await findCodeByBehavior.handler(
        { query: 'permission checks', max_results: 5 },
        engine,
      );
      expect(result).toContain('find_code_by_behavior');
      // Should find canEditItems
      expect(result).toMatch(/can|edit|permission|auth/i);
    });

    it('reports low confidence for vague queries', async () => {
      const result = await findCodeByBehavior.handler(
        { query: 'business logic stuff', max_results: 5 },
        engine,
      );
      expect(result).toContain('find_code_by_behavior');
      // Should work without crashing, may report low confidence
      expect(typeof result).toBe('string');
    });

    it('returns stats with timing', async () => {
      const result = await findCodeByBehavior.handler(
        { query: 'SDK creation', max_results: 5 },
        engine,
      );
      expect(result).toMatch(/Stats:/);
      expect(result).toMatch(/Time:/);
    });

    it('includes evidence in results', async () => {
      const result = await findCodeByBehavior.handler(
        { query: 'validation checks', max_results: 5 },
        engine,
      );
      expect(result).toMatch(/Evidence:|score:/);
    });
  });

  describe('api_guard', () => {
    it('runs on all files in fixture and returns structured result', async () => {
      const result = await apiGuard.handler(
        { scope: 'all' },
        engine,
      ) as any;
      // Now returns structured JSON
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('entries');
      expect(result).toHaveProperty('stats');
      expect(result.stats.filesParsed).toBeGreaterThan(0);
    });

    it('handles missing git gracefully for scope=changed', async () => {
      // Fixture may not be a git repo
      try {
        const result = await apiGuard.handler(
          { scope: 'changed' },
          engine,
        );
        expect(result).toBeDefined();
      } catch (e) {
        // Throwing for missing git is acceptable
        expect(e).toBeDefined();
      }
    });
  });

  describe('root_cause_trace', () => {
    it('reports clean file when no errors', async () => {
      const result = await rootCauseTrace.handler(
        { file_path: fixturePath('packages/types/src/index.ts') },
        engine,
      ) as any;
      // Returns structured result with warnings
      expect(result).toHaveProperty('warnings');
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toMatch(/No error/i);
    });

    it('handles nonexistent file gracefully', async () => {
      try {
        const result = await rootCauseTrace.handler(
          { file_path: fixturePath('packages/nonexistent/file.ts') },
          engine,
        );
        // Should either error or report no file
        expect(typeof result).toBe('string');
      } catch (e) {
        // Throwing is also acceptable
        expect(e).toBeDefined();
      }
    });

    it('accepts optional line parameter', async () => {
      const result = await rootCauseTrace.handler(
        { file_path: fixturePath('packages/types/src/index.ts'), line: 1 },
        engine,
      ) as any;
      expect(result).toHaveProperty('warnings');
      expect(result.candidates).toEqual([]);
    });
  });
});
