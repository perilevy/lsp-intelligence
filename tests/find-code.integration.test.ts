import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getEngine, shutdownEngine, getFixtureRoot } from './setup.js';
import type { LspEngine } from '../src/engine/LspEngine.js';
import { findCode } from '../src/tools/composites/findCode.js';

describe('find_code Integration', () => {
  let engine: LspEngine;

  beforeAll(async () => {
    engine = await getEngine();
  }, 60_000);

  afterAll(async () => {
    await shutdownEngine();
  });

  it('routes "useEffect that returns cleanup conditionally" to structural + finds usage sites', async () => {
    const result = await findCode.handler(
      { query: 'useEffect that returns a cleanup callback conditionally', max_results: 10, include_tests: false, focus: 'auto' },
      engine,
    ) as any;

    expect(result).toHaveProperty('ir');
    expect(result).toHaveProperty('plan');
    expect(result).toHaveProperty('candidates');
    expect(result.ir.exactIdentifiers).toContain('useEffect');
    expect(result.plan.retrievers).toContain('identifier');
    expect(result.plan.retrievers).toContain('structural');
    expect(result.plan.retrievers).not.toContain('behavior');

    // Must find useEffect usage sites — this is the core regression test
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0].matchedIdentifier ?? result.candidates[0].symbol).toMatch(/useEffect|Effect/i);
  });

  it('routes "where do we validate permissions" to behavior mode', async () => {
    const result = await findCode.handler(
      { query: 'where do we validate permissions', max_results: 5, include_tests: false, focus: 'auto' },
      engine,
    ) as any;

    expect(result.plan.retrievers).toContain('behavior');
    expect(result.candidates.length).toBeGreaterThan(0);
    const names = result.candidates.map((c: any) => (c.symbol ?? '').toLowerCase());
    expect(names.some((n: string) => n.includes('valid') || n.includes('permission') || n.includes('can'))).toBe(true);
  });

  it('handles path scoping', async () => {
    const fixtureRoot = getFixtureRoot();
    const result = await findCode.handler(
      { query: 'validate', max_results: 10, include_tests: false, focus: 'auto', paths: [`${fixtureRoot}/packages/core`] },
      engine,
    ) as any;

    for (const c of result.candidates) {
      expect(c.filePath).toMatch(/core/);
    }
  });

  it('degrades with low confidence for vague queries', async () => {
    const result = await findCode.handler(
      { query: 'random business logic stuff xyz', max_results: 5, include_tests: false, focus: 'auto' },
      engine,
    ) as any;

    expect(result).toHaveProperty('confidence');
    expect(['medium', 'low']).toContain(result.confidence);
  });

  it('supports focus=usage override', async () => {
    const result = await findCode.handler(
      { query: 'permission', max_results: 5, include_tests: false, focus: 'usage' },
      engine,
    ) as any;

    expect(result.ir.mode).toBe('identifier');
    expect(result.plan.retrievers).toContain('identifier');
  });

  it('returns structured stats with all fields', async () => {
    const result = await findCode.handler(
      { query: 'validation', max_results: 5, include_tests: false, focus: 'auto' },
      engine,
    ) as any;

    expect(result.stats).toHaveProperty('filesIndexed');
    expect(result.stats).toHaveProperty('declarationHits');
    expect(result.stats).toHaveProperty('usageHits');
    expect(result.stats).toHaveProperty('regexHits');
    expect(result.stats).toHaveProperty('docHits');
    expect(result.stats).toHaveProperty('configHits');
    expect(result.stats).toHaveProperty('graphExpanded');
    expect(result.stats).toHaveProperty('elapsedMs');
    expect(result.stats.filesIndexed).toBeGreaterThan(0);
  });

  it('behavior query still works after redesign', async () => {
    const result = await findCode.handler(
      { query: 'error handling recovery', max_results: 5, include_tests: false, focus: 'auto' },
      engine,
    ) as any;

    expect(result.candidates.length).toBeGreaterThan(0);
    const names = result.candidates.map((c: any) => (c.symbol ?? '').toLowerCase());
    expect(names.some((n: string) => n.includes('error') || n.includes('handle') || n.includes('retry'))).toBe(true);
  });

  it('supports debug output', async () => {
    const result = await findCode.handler(
      { query: 'validation', max_results: 3, include_tests: false, focus: 'auto', debug: true },
      engine,
    ) as any;

    expect(result.debug).toBeDefined();
    expect(result.debug.recipes).toBeInstanceOf(Array);
    expect(result.debug.retrieverStats).toHaveProperty('behavior');
    expect(result.debug.scoreBreakdown).toBeInstanceOf(Array);
  });
});
