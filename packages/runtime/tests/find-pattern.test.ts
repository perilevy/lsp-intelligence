import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import { getEngine, shutdownEngine, getFixtureRoot } from './setup.js';
import type { LspEngine } from '../src/engine/LspEngine.js';
import { findPattern } from '../src/tools/composites/findPattern.js';

describe('find_pattern', () => {
  let engine: LspEngine;

  beforeAll(async () => {
    engine = await getEngine();
  }, 60_000);

  afterAll(async () => {
    await shutdownEngine();
  });

  it('returns structured output', async () => {
    const result = await findPattern.handler(
      { pattern: 'export const $NAME = $$$', language: 'typescript', max_results: 10, context_lines: 1 },
      engine,
    ) as any;
    expect(result).toHaveProperty('pattern');
    expect(result).toHaveProperty('filesScanned');
    expect(result).toHaveProperty('matchCount');
    expect(result).toHaveProperty('matches');
    expect(result).toHaveProperty('warnings');
    expect(result.matchCount).toBeGreaterThan(0);
  });

  it('respects path scoping', async () => {
    const fixtureRoot = getFixtureRoot();
    const result = await findPattern.handler(
      { pattern: 'export function $F($$$) { $$$ }', language: 'typescript', paths: [`${fixtureRoot}/packages/core`], max_results: 50, context_lines: 1 },
      engine,
    ) as any;
    for (const m of result.matches) {
      expect(m.filePath).toMatch(/core/);
    }
  });

  it('respects context_lines parameter', async () => {
    const result = await findPattern.handler(
      { pattern: 'export const $NAME = $$$', language: 'typescript', max_results: 1, context_lines: 3 },
      engine,
    ) as any;
    if (result.matches.length > 0) {
      const contextLines = result.matches[0].context.split('\n').length;
      expect(contextLines).toBeGreaterThanOrEqual(3);
    }
  });

  it('caps results at max_results', async () => {
    const result = await findPattern.handler(
      { pattern: 'export const $NAME = $$$', language: 'typescript', max_results: 2, context_lines: 1 },
      engine,
    ) as any;
    expect(result.matchCount).toBeLessThanOrEqual(2);
  });

  it('returns zero matches for impossible pattern', async () => {
    const result = await findPattern.handler(
      { pattern: 'xyzNeverMatchThis123($$$)', language: 'typescript', max_results: 10, context_lines: 1 },
      engine,
    ) as any;
    expect(result.matchCount).toBe(0);
  });

  it('supports tsx language', async () => {
    const standaloneWeb = path.resolve(import.meta.dirname, '..', 'test-fixtures', 'standalone', 'web', 'src');
    const result = await findPattern.handler(
      { pattern: 'useEffect($$$)', language: 'tsx', paths: [standaloneWeb], max_results: 10, context_lines: 1 },
      engine,
    ) as any;
    expect(result.matchCount).toBeGreaterThan(0);
  });
});
