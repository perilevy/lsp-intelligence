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

export async function getEngine(): Promise<LspEngine> {
  if (engine) return engine;
  engine = new LspEngine(FIXTURE_ROOT);
  await engine.initialize();
  // Extra wait for symbol index to be fully ready (more packages need more time)
  await new Promise((r) => setTimeout(r, 8000));
  return engine;
}

export async function shutdownEngine(): Promise<void> {
  if (engine) {
    await engine.shutdown();
    engine = null;
  }
}
