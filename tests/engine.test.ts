import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getEngine, shutdownEngine, getFixtureRoot } from './setup.js';
import type { LspEngine } from '../src/engine/LspEngine.js';

describe('LspEngine', () => {
  let engine: LspEngine;

  beforeAll(async () => {
    engine = await getEngine();
  }, 60_000);

  afterAll(async () => {
    await shutdownEngine();
  });

  it('initializes successfully', () => {
    expect(engine).toBeDefined();
    expect(engine.workspaceRoot).toBe(getFixtureRoot());
  });

  it('detects git availability', () => {
    // The lsp-intelligence repo is a git repo
    expect(typeof engine.gitAvailable).toBe('boolean');
  });

  it('resolves symbol by name: createSDK', async () => {
    const loc = await engine.resolveSymbol('createSDK');
    expect(loc.name).toBe('createSDK');
    expect(loc.uri).toContain('core/src/');
  });

  it('resolves symbol by name: withConsumer', async () => {
    const loc = await engine.resolveSymbol('withConsumer');
    expect(loc.name).toBe('withConsumer');
    expect(loc.uri).toContain('app/src/');
  });

  it('resolves type alias: SDK', async () => {
    const loc = await engine.resolveSymbol('SDK');
    expect(loc.name).toBe('SDK');
    expect(loc.uri).toContain('core/src/');
  });

  it('throws for nonexistent symbol', async () => {
    await expect(engine.resolveSymbol('xyzNonExistent99')).rejects.toThrow('No symbol found');
  });

  it('prepares file and returns content', async () => {
    const { uri, content } = await engine.prepareFile(
      `${getFixtureRoot()}/packages/core/src/sdk.ts`,
    );
    expect(uri).toContain('core/src/sdk.ts');
    expect(content).toContain('createSDK');
  });
});
