import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getEngine, shutdownEngine, fixturePath, getFixtureRoot } from './setup.js';
import type { LspEngine } from '../src/engine/LspEngine.js';
import { findPattern } from '../src/tools/composites/findPattern.js';
import { findCode } from '../src/tools/composites/findCode.js';
import { apiGuard } from '../src/tools/composites/apiGuard.js';
import { rootCauseTrace } from '../src/tools/composites/rootCauseTrace.js';

describe('Performance Budgets', () => {
  let engine: LspEngine;

  beforeAll(async () => {
    engine = await getEngine();
  }, 60_000);

  afterAll(async () => {
    await shutdownEngine();
  });

  it('find_pattern scans fewer than 200 files', async () => {
    const result = await findPattern.handler(
      { pattern: 'export const $NAME = $$$', language: 'typescript', max_results: 50 },
      engine,
    ) as any;
    expect(result.filesScanned).toBeLessThan(200);
  });

  it('find_code caps enrichment at 15', async () => {
    const result = await findCode.handler(
      { query: 'validation', max_results: 10 },
      engine,
    ) as any;
    expect(result.stats.lspEnriched).toBeLessThanOrEqual(15);
  });

  it('find_code caps AST files scanned', async () => {
    const result = await findCode.handler(
      { query: 'error handling retry', max_results: 5 },
      engine,
    ) as any;
    expect(result.stats.filesIndexed).toBeLessThanOrEqual(120);
  });

  it('api_guard returns partialResult flag when capped', async () => {
    const result = await apiGuard.handler(
      { scope: 'all' },
      engine,
    ) as any;
    // partialResult is only true when cap is hit
    expect(result.stats).toHaveProperty('partialResult');
    expect(typeof result.stats.partialResult).toBe('boolean');
  });

  it('root_cause_trace caps caller checks at 5', async () => {
    const result = await rootCauseTrace.handler(
      { file_path: fixturePath('packages/types/src/index.ts') },
      engine,
    ) as any;
    expect(result.stats.callerFilesChecked).toBeLessThanOrEqual(5);
  });
});

describe('Fixture Scenarios', () => {
  let engine: LspEngine;

  beforeAll(async () => {
    engine = await getEngine();
  }, 60_000);

  afterAll(async () => {
    await shutdownEngine();
  });

  describe('cross-package export consumption', () => {
    it('api_guard detects exports from types package used by core and app', async () => {
      const result = await apiGuard.handler(
        { scope: 'all', file_path: fixturePath('packages/types/src/index.ts') },
        engine,
      ) as any;
      expect(result.summary.exportsChecked).toBeGreaterThan(0);
      // Config, ItemStatus, PaginatedResponse are exported
      const names = result.entries.map((e: any) => e.exportName);
      // All entries should be additive (no base for comparison in fixture)
      for (const entry of result.entries) {
        expect(entry.kind).toBe('added');
      }
    });
  });

  describe('behavior search scenarios', () => {
    it('finds validation functions in the fixture', async () => {
      const result = await findCode.handler(
        { query: 'validate config', max_results: 5 },
        engine,
      ) as any;
      const symbolNames = result.candidates.map((c: any) => c.symbol?.toLowerCase() ?? '');
      expect(symbolNames.some((n: string) => n.includes('valid'))).toBe(true);
    });

    it('finds error handling in the fixture', async () => {
      const result = await findCode.handler(
        { query: 'error handler recovery', max_results: 5 },
        engine,
      ) as any;
      const symbolNames = result.candidates.map((c: any) => c.symbol?.toLowerCase() ?? '');
      expect(symbolNames.some((n: string) => n.includes('error') || n.includes('handle') || n.includes('retry'))).toBe(true);
    });

    it('finds permission/guard functions in the fixture', async () => {
      const result = await findCode.handler(
        { query: 'can user edit', max_results: 5 },
        engine,
      ) as any;
      const symbolNames = result.candidates.map((c: any) => c.symbol?.toLowerCase() ?? '');
      expect(symbolNames.some((n: string) => n.includes('can') || n.includes('edit') || n.includes('permission'))).toBe(true);
    });
  });

  describe('switch exhaustiveness scenario', () => {
    it('find_pattern detects switch statements in fixture', async () => {
      const result = await findPattern.handler(
        { pattern: 'switch ($VAR) { $$$ }', language: 'typescript', max_results: 10 },
        engine,
      ) as any;
      // statusHandler.ts has a switch on ItemStatus
      expect(result.matchCount).toBeGreaterThan(0);
    });
  });

  describe('re-export/barrel scenario', () => {
    it('api_guard parses core/index.ts without error', async () => {
      const result = await apiGuard.handler(
        { scope: 'all', file_path: fixturePath('packages/core/src/index.ts') },
        engine,
      ) as any;
      // Should parse successfully and report export count
      expect(result.summary.exportsChecked).toBeGreaterThan(0);
    });
  });
});
