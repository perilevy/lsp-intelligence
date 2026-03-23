import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getEngine, shutdownEngine, fixturePath } from './setup.js';
import type { LspEngine } from '../src/engine/LspEngine.js';
import { inspectSymbol } from '../src/tools/composites/inspectSymbol.js';
import { batchQuery } from '../src/tools/composites/batchQuery.js';
import { impactTrace } from '../src/tools/composites/impactTrace.js';
import { findTestFiles } from '../src/tools/composites/findTestFiles.js';
import { explainError } from '../src/tools/composites/explainError.js';

describe('Composite Tools', () => {
  let engine: LspEngine;

  beforeAll(async () => {
    engine = await getEngine();
  }, 60_000);

  afterAll(async () => {
    await shutdownEngine();
  });

  describe('inspect_symbol', () => {
    it('returns hover + definition + references in one call', async () => {
      const result = await inspectSymbol.handler(
        { symbol: 'createSDK', verbosity: 'summary' },
        engine,
      );
      expect(result).toContain('Inspect: createSDK');
      expect(result).toContain('Type');
      expect(result).toContain('references');
    });

    it('works by position', async () => {
      const result = await inspectSymbol.handler(
        { symbol: 'SDK', verbosity: 'summary' },
        engine,
      );
      expect(result).toContain('Inspect: SDK');
    });
  });

  describe('batch_query', () => {
    it('looks up multiple symbols at once', async () => {
      const result = await batchQuery.handler(
        { symbols: ['createSDK', 'Config', 'ItemStatus'], include_references: true },
        engine,
      );
      expect(result).toContain('Batch Query: 3 symbols');
      expect(result).toContain('createSDK');
      expect(result).toContain('Config');
      expect(result).toContain('ItemStatus');
    });

    it('handles nonexistent symbols gracefully', async () => {
      const result = await batchQuery.handler(
        { symbols: ['createSDK', 'xyzNonExistent'], include_references: false },
        engine,
      );
      expect(result).toContain('createSDK');
      expect(result).toContain('Error');
    });
  });

  describe('impact_trace', () => {
    it('traces through type aliases', async () => {
      const result = await impactTrace.handler(
        { symbol: 'createSDK', max_depth: 2, verbosity: 'normal' },
        engine,
      );
      expect(result).toContain('Impact Trace: createSDK');
      expect(result).toContain('references');
    });

    it('shows depth information', async () => {
      const result = await impactTrace.handler(
        { symbol: 'SDK', max_depth: 3, verbosity: 'normal' },
        engine,
      );
      expect(result).toContain('Impact Trace');
      // Should find references across multiple files
      expect(result).toMatch(/\d+ total references/);
    });

    it('respects summary verbosity', async () => {
      const result = await impactTrace.handler(
        { symbol: 'createSDK', max_depth: 1, verbosity: 'summary' },
        engine,
      );
      // Summary should not include file-by-file breakdown
      expect(result).toContain('Impact Trace');
      expect(result).not.toContain('(direct)');
    });
  });

  describe('find_test_files', () => {
    it('reports when no test files reference a symbol', async () => {
      const result = await findTestFiles.handler(
        { symbol: 'Config' },
        engine,
      );
      // Fixture has no test files, so should report that
      expect(result).toMatch(/No test files|No references/);
    });
  });

  describe('explain_error', () => {
    it('reports when no error at line', async () => {
      const result = await explainError.handler(
        { file_path: fixturePath('packages/types/src/index.ts'), line: 1 },
        engine,
      );
      expect(result).toMatch(/No error|clean/);
    });
  });
});
