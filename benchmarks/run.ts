#!/usr/bin/env npx tsx
/**
 * Benchmark runner — two tiers:
 * 1. Planner benchmarks: fast, no LSP (parser + planner only)
 * 2. End-to-end benchmarks: full find_code against test fixtures
 *
 * Usage: npx tsx benchmarks/run.ts [--e2e]
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseQuery } from '../src/search/query/parseQuery.js';
import { planQuery } from '../src/search/query/planQuery.js';
import { findCode } from '../src/tools/composites/findCode.js';
import { LspEngine } from '../src/engine/LspEngine.js';

interface BenchmarkCase {
  id: string;
  category: string;
  query: string;
  fixture: string;
  expected: {
    mode?: string;
    retrievers?: string[];
    notRetrievers?: string[];
    topFiles?: string[];
    topSymbols?: string[];
    notTopSymbols?: string[];
    confidenceFloor?: string;
  };
  notes?: string;
}

const CONFIDENCE_ORDER = ['low', 'medium', 'high'];

// Map fixture name → absolute path
const FIXTURE_ROOTS: Record<string, string> = {
  monorepo: path.resolve(import.meta.dirname, '..', 'test-fixtures', 'monorepo'),
  'config-app': path.resolve(import.meta.dirname, '..', 'test-fixtures', 'standalone', 'config-app'),
  'js-web': path.resolve(import.meta.dirname, '..', 'test-fixtures', 'standalone', 'js-web'),
};

async function main() {
  const runE2E = process.argv.includes('--e2e');
  const BENCHMARK_DIR = path.resolve(import.meta.dirname, 'find-code');
  const files = fs.readdirSync(BENCHMARK_DIR).filter((f) => f.endsWith('.json'));

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  // --- Tier 1: Planner benchmarks (always run) ---
  console.log('=== Planner benchmarks ===\n');

  for (const file of files) {
    const bench: BenchmarkCase = JSON.parse(fs.readFileSync(path.join(BENCHMARK_DIR, file), 'utf-8'));
    const ir = parseQuery(bench.query);
    const plan = planQuery(ir);
    const checks: string[] = [];

    if (bench.expected.mode && ir.mode !== bench.expected.mode) {
      checks.push(`mode: expected ${bench.expected.mode}, got ${ir.mode}`);
    }
    if (bench.expected.retrievers) {
      for (const r of bench.expected.retrievers) {
        if (!plan.retrievers.includes(r as any)) checks.push(`retriever missing: ${r}`);
      }
    }
    if (bench.expected.notRetrievers) {
      for (const r of bench.expected.notRetrievers) {
        if (plan.retrievers.includes(r as any)) checks.push(`unexpected retriever: ${r}`);
      }
    }

    if (checks.length === 0) { passed++; console.log(`  PASS  ${bench.id}`); }
    else { failed++; const msg = `  FAIL  ${bench.id}: ${checks.join(', ')}`; console.log(msg); failures.push(msg); }
  }

  // --- Tier 2: End-to-end benchmarks (--e2e flag) ---
  if (runE2E) {
    console.log('\n=== End-to-end benchmarks ===\n');

    // Group benchmarks by fixture (skip unknown fixtures)
    const allBenches = files.map((f) => JSON.parse(fs.readFileSync(path.join(BENCHMARK_DIR, f), 'utf-8')) as BenchmarkCase);
    const byFixture = new Map<string, BenchmarkCase[]>();
    for (const b of allBenches) {
      if (!FIXTURE_ROOTS[b.fixture]) continue;
      if (!byFixture.has(b.fixture)) byFixture.set(b.fixture, []);
      byFixture.get(b.fixture)!.push(b);
    }

    for (const [fixtureName, benches] of byFixture) {
      const fixtureRoot = FIXTURE_ROOTS[fixtureName];
      const engine = new LspEngine(fixtureRoot);
      await engine.initialize();

      // Wait for index readiness
      if (fixtureName === 'monorepo') {
        for (let i = 0; i < 30; i++) {
          try { await engine.resolveSymbol('createSDK'); break; } catch { await new Promise((r) => setTimeout(r, 500)); }
        }
      } else {
        // Other fixtures: fixed delay for LSP to index files
        await new Promise((r) => setTimeout(r, 2000));
      }

      for (const bench of benches) {
        const checks: string[] = [];
        try {
          const result = await findCode.handler(
            { query: bench.query, max_results: 10, include_tests: false, focus: 'auto' as any },
            engine,
          ) as any;

          // Check top files
          if (bench.expected.topFiles) {
            for (const f of bench.expected.topFiles) {
              if (!result.candidates.some((c: any) => c.filePath?.includes(f))) {
                checks.push(`top file missing: ${f}`);
              }
            }
          }

          // Check top symbols
          if (bench.expected.topSymbols) {
            const symbols = result.candidates.map((c: any) => c.symbol ?? c.matchedIdentifier ?? '');
            for (const s of bench.expected.topSymbols) {
              if (!symbols.some((sym: string) => sym.includes(s))) {
                checks.push(`top symbol missing: ${s} (got: ${symbols.slice(0, 5).join(', ')})`);
              }
            }
          }

          // Check NOT top symbols
          if (bench.expected.notTopSymbols) {
            const top3 = result.candidates.slice(0, 3).map((c: any) => c.symbol ?? c.matchedIdentifier ?? '');
            for (const s of bench.expected.notTopSymbols) {
              if (top3.some((sym: string) => sym.includes(s))) {
                checks.push(`unexpected top symbol: ${s}`);
              }
            }
          }

          // Check confidence floor
          if (bench.expected.confidenceFloor) {
            const floor = CONFIDENCE_ORDER.indexOf(bench.expected.confidenceFloor);
            const actual = CONFIDENCE_ORDER.indexOf(result.confidence);
            if (actual < floor) {
              checks.push(`confidence: expected >= ${bench.expected.confidenceFloor}, got ${result.confidence}`);
            }
          }

          // Must have at least one candidate
          if (result.candidates.length === 0) {
            checks.push('no candidates returned');
          }
        } catch (err: any) {
          checks.push(`error: ${err.message}`);
        }

        if (checks.length === 0) { passed++; console.log(`  PASS  [e2e] ${bench.id}`); }
        else { failed++; const msg = `  FAIL  [e2e] ${bench.id}: ${checks.join(', ')}`; console.log(msg); failures.push(msg); }
      }

      await engine.shutdown();
    }
  }

  // --- Summary ---
  console.log(`\n${passed + failed} benchmarks: ${passed} passed, ${failed} failed`);
  if (!runE2E) console.log('(run with --e2e for full end-to-end validation)');
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(f);
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
