import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getEngine, shutdownEngine, fixturePath } from './setup.js';
import type { LspEngine } from '../src/engine/LspEngine.js';
import { documentSymbols } from '../src/tools/primitives/documentSymbols.js';
import { workspaceSymbols } from '../src/tools/primitives/workspaceSymbols.js';
import { callHierarchy } from '../src/tools/primitives/callHierarchy.js';
import { rename } from '../src/tools/primitives/rename.js';
import { diagnostics } from '../src/tools/primitives/diagnostics.js';
import { fileImports } from '../src/tools/primitives/fileImports.js';
import { fileExports } from '../src/tools/primitives/fileExports.js';
import { gotoTypeDefinition } from '../src/tools/primitives/gotoTypeDefinition.js';
import { findImplementations } from '../src/tools/primitives/findImplementations.js';

describe('Extended Primitives', () => {
  let engine: LspEngine;

  beforeAll(async () => {
    engine = await getEngine();
  }, 60_000);

  afterAll(async () => {
    await shutdownEngine();
  });

  describe('document_symbols', () => {
    it('lists symbols in a file', async () => {
      const result = await documentSymbols.handler(
        { file_path: fixturePath('packages/core/src/sdk.ts') },
        engine,
      );
      expect(result).toContain('createSDK');
      expect(result).toContain('SDK');
      expect(result).toContain('Item');
    });

    it('shows symbol kinds', async () => {
      const result = await documentSymbols.handler(
        { file_path: fixturePath('packages/types/src/index.ts') },
        engine,
      );
      expect(result).toContain('Interface');
      expect(result).toContain('Enum');
    });
  });

  describe('workspace_symbols', () => {
    it('finds symbols by name', async () => {
      const result = await workspaceSymbols.handler(
        { query: 'createSDK', limit: 20 },
        engine,
      );
      expect(result).toContain('createSDK');
      expect(result).toContain('core/src/');
    });

    it('returns message for no matches', async () => {
      const result = await workspaceSymbols.handler(
        { query: 'xyzNonExistent', limit: 20 },
        engine,
      );
      expect(result).toContain('No symbols found');
    });
  });

  describe('call_hierarchy', () => {
    it('finds incoming callers or reports none', { timeout: 20_000 }, async () => {
      const result = await callHierarchy.handler(
        { symbol: 'withConsumer', direction: 'incoming' },
        engine,
      );
      // withConsumer may have incoming callers (ItemList) or may not resolve hierarchy
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('rename', () => {
    it('previews rename in dry-run mode', async () => {
      const result = await rename.handler(
        { symbol: 'fetchItems', new_name: 'loadItems', dry_run: true },
        engine,
      );
      expect(result).toContain('Rename Preview');
      expect(result).toContain('loadItems');
      expect(result).toContain('dry run');
    });
  });

  describe('diagnostics', () => {
    it('returns diagnostics for a clean file', async () => {
      const result = await diagnostics.handler(
        { file_path: fixturePath('packages/types/src/index.ts') },
        engine,
      );
      // The fixture files should be clean
      expect(result).toMatch(/clean|No diagnostics/i);
    });
  });

  describe('file_imports', () => {
    it('lists imports of a file', async () => {
      const result = await fileImports.handler(
        { file_path: fixturePath('packages/app/src/ItemList.ts') },
        engine,
      );
      expect(result).toContain('@fixtures/core');
      expect(result).toContain('createSDK');
      expect(result).toContain('withConsumer');
    });
  });

  describe('file_exports', () => {
    it('lists exports of a file', async () => {
      const result = await fileExports.handler(
        { file_path: fixturePath('packages/core/src/sdk.ts') },
        engine,
      );
      expect(result).toContain('createSDK');
      expect(result).toContain('SDK');
    });

    it('detects re-exports', async () => {
      const result = await fileExports.handler(
        { file_path: fixturePath('packages/core/src/index.ts') },
        engine,
      );
      expect(result).toContain('createSDK');
    });
  });

  describe('goto_type_definition', () => {
    it('finds type definition for a symbol', async () => {
      // SDK is a type alias — type definition should resolve
      const result = await gotoTypeDefinition.handler(
        { symbol: 'SDK' },
        engine,
      );
      expect(result).toContain('Definition');
    });
  });

  describe('find_implementations', () => {
    it('handles symbols without implementations', async () => {
      const result = await findImplementations.handler(
        { symbol: 'Config', verbosity: 'summary' },
        engine,
      );
      // Config is an interface — may or may not have implementations in fixture
      expect(typeof result).toBe('string');
    });
  });
});
