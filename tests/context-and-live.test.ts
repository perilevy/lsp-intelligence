import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getEngine, shutdownEngine, fixturePath } from './setup.js';
import type { LspEngine } from '../src/engine/LspEngine.js';
import { outline } from '../src/tools/context/outline.js';
import { gatherContext } from '../src/tools/context/gatherContext.js';
import { liveDiagnostics } from '../src/tools/live/liveDiagnostics.js';
import { findUnusedExports } from '../src/tools/live/findUnusedExports.js';
import { autoImport } from '../src/tools/live/autoImport.js';

describe('Context Tools', () => {
  let engine: LspEngine;

  beforeAll(async () => {
    engine = await getEngine();
  }, 60_000);

  afterAll(async () => {
    await shutdownEngine();
  });

  describe('outline', () => {
    it('shows file structure with symbols', async () => {
      const result = await outline.handler(
        { file_path: fixturePath('packages/core/src/sdk.ts'), include_signatures: false },
        engine,
      );
      expect(result).toContain('sdk.ts');
      expect(result).toContain('createSDK');
      expect(result).toContain('SDK');
      expect(result).toContain('Item');
    });

    it('includes type signatures when requested', async () => {
      const result = await outline.handler(
        { file_path: fixturePath('packages/core/src/sdk.ts'), include_signatures: true },
        engine,
      );
      expect(result).toContain('createSDK');
      // Should have backtick-wrapped signatures
      expect(result).toContain('`');
    });
  });

  describe('gather_context', () => {
    it('builds context for a symbol', async () => {
      const result = await gatherContext.handler(
        { symbols: ['createSDK'], max_tokens: 4000, depth: 2 },
        engine,
      );
      expect(result).toContain('Context for: createSDK');
      expect(result).toContain('symbols traced');
      // Should have some must-modify or verify sections
      expect(result).toMatch(/Must modify|Verify only|Skip/);
    });

    it('respects token budget', async () => {
      const result = await gatherContext.handler(
        { symbols: ['SDK'], max_tokens: 500, depth: 1 },
        engine,
      );
      expect(result).toContain('Context for: SDK');
      // With 500 token budget, should be concise
      expect(result.length).toBeLessThan(5000);
    });

    it('handles nonexistent symbols', async () => {
      const result = await gatherContext.handler(
        { symbols: ['xyzNonExistent'], max_tokens: 1000, depth: 1 },
        engine,
      );
      expect(result).toContain('Error');
    });
  });
});

describe('Live Tools', () => {
  let engine: LspEngine;

  beforeAll(async () => {
    engine = await getEngine();
  }, 60_000);

  afterAll(async () => {
    await shutdownEngine();
  });

  describe('live_diagnostics', () => {
    it('reports clean file', async () => {
      const result = await liveDiagnostics.handler(
        { file_path: fixturePath('packages/types/src/index.ts') },
        engine,
      );
      expect(result).toMatch(/no errors|clean/i);
    });
  });

  describe('find_unused_exports', () => {
    it('checks exports of a file', async () => {
      const result = await findUnusedExports.handler(
        { file_path: fixturePath('packages/types/src/index.ts') },
        engine,
      );
      // types/src/index.ts exports Config, ItemStatus, PaginatedResponse
      // They should be used by core package
      expect(typeof result).toBe('string');
    });
  });

  describe('auto_import', () => {
    it('resolves import path for a symbol', async () => {
      const result = await autoImport.handler(
        { symbol: 'createSDK' },
        engine,
      );
      expect(result).toContain('Auto Import: createSDK');
      expect(result).toContain('import { createSDK }');
      // Should NOT contain malformed paths like "coresrc" or "sdksrc"
      expect(result).not.toMatch(/[a-z]src"/);
    });

    it('resolves cross-package import using tsconfig paths', async () => {
      // app/tsconfig.json has paths: { "@fixtures/core": ["../core/src"] }
      // When importing from app, Config should resolve via @fixtures/types
      const result = await autoImport.handler(
        { symbol: 'Config', from_file: fixturePath('packages/app/src/index.ts') },
        engine,
      );
      expect(result).toContain('Auto Import: Config');
      expect(result).toContain('import { Config }');
      // Should use the alias, not a raw relative path
      expect(result).toMatch(/@fixtures|types/);
    });

    it('produces a valid import path (no double slashes or trailing extensions)', async () => {
      const result = await autoImport.handler(
        { symbol: 'SDK' },
        engine,
      );
      expect(result).toContain('import { SDK }');
      // Path should not have .ts extension or double slashes
      expect(result).not.toMatch(/\.ts"/);
      expect(result).not.toContain('//');
    });
  });
});
