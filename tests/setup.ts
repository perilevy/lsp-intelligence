import * as path from 'path';
import { LspEngine } from '../src/engine/LspEngine.js';

const FIXTURE_ROOT = path.resolve(import.meta.dirname, '..', 'test-fixtures', 'monorepo');

let engine: LspEngine | null = null;

export function getFixtureRoot(): string {
  return FIXTURE_ROOT;
}

export function fixturePath(...segments: string[]): string {
  return path.join(FIXTURE_ROOT, ...segments);
}

/**
 * Wait until the engine's symbol index is responsive by polling workspace/symbol.
 * Replaces the old fixed 8s sleep — faster on fast machines, still reliable on slow CI.
 */
async function waitForIndexReady(eng: LspEngine, timeoutMs: number = 30_000): Promise<void> {
  const start = Date.now();
  const knownSymbol = 'createSDK'; // exists in test-fixtures/monorepo/packages/core/src/sdk.ts

  while (Date.now() - start < timeoutMs) {
    try {
      const loc = await eng.resolveSymbol(knownSymbol);
      if (loc) return; // Index is ready
    } catch {
      // Not ready yet — retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  // Fallback: proceed anyway (some tests may still pass without full index)
  console.error('[setup] Warning: symbol index did not become ready within timeout');
}

export async function getEngine(): Promise<LspEngine> {
  if (engine) return engine;
  engine = new LspEngine(FIXTURE_ROOT);
  await engine.initialize();
  await waitForIndexReady(engine);
  return engine;
}

export async function shutdownEngine(): Promise<void> {
  if (engine) {
    await engine.shutdown();
    engine = null;
  }
}
