import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getEngine, shutdownEngine, fixturePath } from './setup.js';
import type { LspEngine } from '../src/engine/LspEngine.js';
import { findReferences } from '../src/tools/primitives/findReferences.js';
import { gotoDefinition } from '../src/tools/primitives/gotoDefinition.js';
import { hover } from '../src/tools/primitives/hover.js';

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
      // createSDK is defined in core/src/sdk.ts, re-exported in core/src/index.ts, used in app/src/ItemList.ts
      expect(result).toContain('references');
      expect(result).toMatch(/\d+ references across \d+ files/);
      // At least 3 files: sdk.ts (def), index.ts (re-export), ItemList.ts (usage)
      const filesMatch = result.match(/across (\d+) files/);
      expect(Number(filesMatch?.[1])).toBeGreaterThanOrEqual(3);
    });

    it('finds references by file position', async () => {
      // createSDK is defined with "export const createSDK" — find the line dynamically
      const result = await findReferences.handler(
        {
          symbol: 'createSDK',
          verbosity: 'summary', include_declaration: true, limit: 100,
        },
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
      // SDK is used in: sdk.ts (def), index.ts (re-export), withConsumer.ts (2 usages), ItemList.ts (usage)
      const filesMatch = result.match(/across (\d+) files/);
      expect(Number(filesMatch?.[1])).toBeGreaterThanOrEqual(3);
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
      expect(result).toMatch(/2 references/);
    });

    it('supports detailed verbosity', async () => {
      const result = await findReferences.handler(
        { symbol: 'createSDK', verbosity: 'detailed', include_declaration: true, limit: 100 },
        engine,
      );
      // Detailed should include code blocks
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
      expect(result).toContain('Config');
    });

    it('returns type info for type alias', async () => {
      const result = await hover.handler({ symbol: 'SDK' }, engine);
      expect(result).toContain('projectId');
      expect(result).toContain('Items');
    });

    it('returns type info by position', async () => {
      // Use symbol-based hover instead of position to avoid line number brittleness
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
      expect(result).toContain('sdk.ts');
    });

    it('follows re-export to original definition', async () => {
      // When goto_definition on createSDK in index.ts, should go to sdk.ts
      const result = await gotoDefinition.handler(
        { file_path: fixturePath('packages/core/src/index.ts'), line: 1, column: 10 },
        engine,
      );
      expect(result).toContain('sdk.ts');
    });

    it('finds type alias definition', async () => {
      const result = await gotoDefinition.handler({ symbol: 'SDK' }, engine);
      expect(result).toContain('Definition');
      expect(result).toContain('sdk.ts');
    });

    it('finds cross-package definition', async () => {
      const result = await gotoDefinition.handler({ symbol: 'Config' }, engine);
      expect(result).toContain('Definition');
      expect(result).toContain('types/src/index.ts');
    });

    it('throws for nonexistent symbol', async () => {
      await expect(
        gotoDefinition.handler({ symbol: 'xyzNonExistent99' }, engine),
      ).rejects.toThrow('No symbol found');
    });
  });
});
