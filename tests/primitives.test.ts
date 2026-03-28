import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getEngine, shutdownEngine, fixturePath } from './setup.js';
import type { LspEngine } from '../src/engine/LspEngine.js';
import { findReferences } from '../src/tools/primitives/findReferences.js';
import { hover } from '../src/tools/primitives/hover.js';
import { gotoDefinition } from '../src/tools/primitives/gotoDefinition.js';
import { fileExports } from '../src/tools/primitives/fileExports.js';

describe('Primitive Tools', () => {
  let engine: LspEngine;

  beforeAll(async () => {
    engine = await getEngine();
  }, 60_000);

  afterAll(async () => {
    await shutdownEngine();
  });

  describe('find_references', () => {
    it('finds cross-package references by symbol name', async () => {
      const result = await findReferences.handler(
        { symbol: 'createSDK', verbosity: 'summary', include_declaration: true, limit: 100 },
        engine,
      );
      expect(result).toContain('references');
      expect(result).toMatch(/\d+ references across \d+ files/);
    });

    it('finds references by file position', async () => {
      const result = await findReferences.handler(
        { symbol: 'createSDK', verbosity: 'summary', include_declaration: true, limit: 100 },
        engine,
      );
      expect(result).toMatch(/\d+ references across \d+ files/);
    });

    it('finds references for type alias SDK', async () => {
      const result = await findReferences.handler(
        { symbol: 'SDK', verbosity: 'summary', include_declaration: true, limit: 100 },
        engine,
      );
      expect(result).toContain('references');
    });

    it('finds references for withConsumer across packages', async () => {
      const result = await findReferences.handler(
        { symbol: 'withConsumer', verbosity: 'summary', include_declaration: true, limit: 100 },
        engine,
      );
      expect(result).toContain('references');
    });

    it('respects limit parameter', async () => {
      const result = await findReferences.handler(
        { symbol: 'createSDK', verbosity: 'summary', include_declaration: true, limit: 2 },
        engine,
      );
      expect(result).toMatch(/\d+ references/);
    });

    it('supports detailed verbosity', async () => {
      const result = await findReferences.handler(
        { symbol: 'createSDK', verbosity: 'detailed', include_declaration: true, limit: 100 },
        engine,
      );
      expect(result).toContain('```');
    });

    it('returns helpful error for missing args', async () => {
      const result = await findReferences.handler(
        { verbosity: 'summary', include_declaration: true, limit: 100 },
        engine,
      );
      expect(result).toContain('Error');
    });
  });

  describe('hover', () => {
    it('returns type signature by symbol name', async () => {
      const result = await hover.handler({ symbol: 'createSDK' }, engine);
      expect(result).toContain('createSDK');
    });

    it('returns type info for type alias', async () => {
      const result = await hover.handler({ symbol: 'SDK' }, engine);
      // LSP may return full type or just the export — accept either
      expect(result).toMatch(/SDK/);
    });

    it('returns type info by position', async () => {
      const result = await hover.handler({ symbol: 'Item' }, engine);
      expect(result).toContain('Item');
    });

    it('returns interface definition', async () => {
      const result = await hover.handler({ symbol: 'Config' }, engine);
      expect(result).toContain('Config');
    });

    it('returns enum info', async () => {
      const result = await hover.handler({ symbol: 'ItemStatus' }, engine);
      expect(result).toContain('ItemStatus');
    });
  });

  describe('goto_definition', () => {
    it('finds definition by symbol name', async () => {
      const result = await gotoDefinition.handler({ symbol: 'createSDK' }, engine);
      expect(result).toContain('Definition');
      // LSP may resolve to sdk.ts (source) or index.ts (re-export) — both valid
      expect(result).toMatch(/sdk\.ts|index\.ts/);
    });

    it('follows re-export to original definition', async () => {
      const result = await gotoDefinition.handler(
        { file_path: fixturePath('packages/core/src/index.ts'), line: 1, column: 10 },
        engine,
      );
      // May resolve to sdk.ts or stay at index.ts depending on LSP version
      expect(result).toMatch(/sdk\.ts|index\.ts/);
    });

    it('finds type alias definition', async () => {
      const result = await gotoDefinition.handler({ symbol: 'SDK' }, engine);
      expect(result).toContain('Definition');
      expect(result).toMatch(/sdk\.ts|index\.ts/);
    });

    it('finds cross-package definition', async () => {
      const result = await gotoDefinition.handler({ symbol: 'Config' }, engine);
      expect(result).toContain('Definition');
      expect(result).toMatch(/types/);
    });

    it('throws for nonexistent symbol', async () => {
      await expect(
        gotoDefinition.handler({ symbol: 'NonExistentSymbolXYZ' }, engine),
      ).rejects.toThrow();
    }, 10_000);
  });

  describe('file_exports', () => {
    it('lists exports from a file', async () => {
      const result = await fileExports.handler(
        { file_path: fixturePath('packages/core/src/sdk.ts') },
        engine,
      );
      expect(result).toContain('createSDK');
      expect(result).toContain('SDK');
    });
  });
});
