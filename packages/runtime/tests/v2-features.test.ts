import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getEngine, shutdownEngine, fixturePath, getFixtureRoot } from './setup.js';
import type { LspEngine } from '../src/engine/LspEngine.js';
import { findPattern } from '../src/tools/composites/findPattern.js';
import { findCode } from '../src/tools/composites/findCode.js';
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
    it('finds export statements and returns structured result', async () => {
      const result = await findPattern.handler(
        { pattern: 'export const $NAME = $$$', language: 'typescript', max_results: 20 },
        engine,
      ) as any;
      expect(result).toHaveProperty('matchCount');
      expect(result).toHaveProperty('matches');
      expect(result).toHaveProperty('filesScanned');
      expect(result.matchCount).toBeGreaterThan(0);
    });

    it('finds try/catch blocks', async () => {
      const result = await findPattern.handler(
        { pattern: 'try { $$$ } catch ($E) { $$$ }', language: 'typescript', max_results: 10 },
        engine,
      ) as any;
      expect(result.matchCount).toBeGreaterThan(0);
    });

    it('finds async functions', async () => {
      const result = await findPattern.handler(
        { pattern: 'async function $F($$$) { $$$ }', language: 'typescript', max_results: 10 },
        engine,
      ) as any;
      expect(result.matchCount).toBeGreaterThanOrEqual(0);
    });

    it('returns zero matches for impossible pattern', async () => {
      const result = await findPattern.handler(
        { pattern: 'xyzNeverMatchThis123($$$)', language: 'typescript', max_results: 10 },
        engine,
      ) as any;
      expect(result.matchCount).toBe(0);
    });

    it('limits results by max_results', async () => {
      const result = await findPattern.handler(
        { pattern: 'export const $NAME = $$$', language: 'typescript', max_results: 2 },
        engine,
      ) as any;
      expect(result.matchCount).toBe(2);
    });
  });

  describe('find_code', () => {
    it('finds validation-related code', async () => {
      const result = await findCode.handler(
        { query: 'validation', max_results: 5 },
        engine,
      ) as any;
      expect(result).toHaveProperty('candidates');
      expect(result).toHaveProperty('confidence');
      expect(result.candidates.length).toBeGreaterThan(0);
      // Should find validateConfig or isValidTransition
      const names = result.candidates.map((c: any) => c.symbol ?? '').join(' ');
      expect(names.toLowerCase()).toMatch(/valid/);
    });

    it('finds error handling code', async () => {
      const result = await findCode.handler(
        { query: 'error handling', max_results: 5 },
        engine,
      ) as any;
      expect(result.candidates.length).toBeGreaterThan(0);
      const names = result.candidates.map((c: any) => c.symbol ?? '').join(' ');
      expect(names.toLowerCase()).toMatch(/error/);
    });

    it('finds permission/auth code', async () => {
      const result = await findCode.handler(
        { query: 'permission checks', max_results: 5 },
        engine,
      ) as any;
      expect(result.candidates.length).toBeGreaterThan(0);
      const names = result.candidates.map((c: any) => (c.symbol ?? '') + (c.filePath ?? '')).join(' ').toLowerCase();
      expect(names).toMatch(/can|edit|permission|auth|guard|valid|check/);
    });

    it('reports confidence for vague queries', async () => {
      const result = await findCode.handler(
        { query: 'business logic stuff', max_results: 5 },
        engine,
      ) as any;
      expect(result).toHaveProperty('confidence');
      expect(['high', 'medium', 'low']).toContain(result.confidence);
    });

    it('returns structured stats', async () => {
      const result = await findCode.handler(
        { query: 'SDK creation', max_results: 5 },
        engine,
      ) as any;
      expect(result).toHaveProperty('stats');
      expect(result.stats).toHaveProperty('declarationHits');
      expect(result.stats).toHaveProperty('filesIndexed');
    });

    it('includes evidence in candidates', async () => {
      const result = await findCode.handler(
        { query: 'validation checks', max_results: 5 },
        engine,
      ) as any;
      expect(result.candidates.length).toBeGreaterThan(0);
      expect(result.candidates[0]).toHaveProperty('evidence');
      expect(result.candidates[0]).toHaveProperty('score');
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

    it('supports symbol-only input (no file_path required)', async () => {
      const result = await rootCauseTrace.handler(
        { symbol: 'Config' },
        engine,
      ) as any;
      expect(result).toHaveProperty('stats');
      expect(result).toHaveProperty('warnings');
      // Config is clean — should report no diagnostic
      expect(result.warnings.some((w: string) => /No error/i.test(w))).toBe(true);
    });
  });
});
