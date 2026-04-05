#!/usr/bin/env npx tsx
/**
 * API Guard benchmark runner.
 *
 * For each fixture JSON in benchmarks/api-guard/, looks for a matching case
 * directory under test-fixtures/benchmarks/api-guard/<id>/ with base/ and head/
 * subdirectories, creates a temporary git repo, and runs api_guard against it.
 *
 * Uses a minimal mock engine — api_guard's core contract detection is AST + git,
 * no LSP needed. Consumer LSP lookups gracefully fail to null via catch handlers.
 *
 * Usage: npx tsx benchmarks/run-api-guard.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { createBenchmarkRepo } from './lib/createBenchmarkRepo.js';
import { apiGuard } from '../src/tools/composites/apiGuard.js';
import { pathToUri } from '../src/engine/positions.js';

interface ApiGuardBenchmark {
  id: string;
  category: string;
  description: string;
  fixture: string;
  input: { scope?: 'changed' | 'all'; file_path?: string; symbol?: string };
  expected: {
    risk?: string;
    semver?: 'major' | 'minor' | 'patch';
    explanation_contains?: string[];
  };
  notes?: string;
}

// Semantic risk map: benchmark uses high/medium/low, apiGuard uses breaking/risky/safe
const RISK_MAP: Record<string, string> = { high: 'breaking', medium: 'risky', low: 'safe' };

// Minimal mock engine — api_guard's core path (git diff + AST) does not need LSP.
// Consumer lookup calls (prepareFile / request) fail gracefully via catch handlers.
function makeMockEngine(root: string): any {
  return {
    workspaceRoot: root,
    gitAvailable: true,
    prepareFile: async (_fp: string) => { throw new Error('mock: no LSP'); },
    request: async () => null,
    docManager: { getCachedDiagnostics: () => [] },
  };
}

async function main() {
  const BENCH_DIR = path.resolve(import.meta.dirname, 'api-guard');
  const FIXTURE_DIR = path.resolve(import.meta.dirname, '..', 'test-fixtures', 'benchmarks', 'api-guard');

  const files = fs.readdirSync(BENCH_DIR).filter((f) => f.endsWith('.json'));

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  console.log('=== API Guard benchmarks ===\n');

  for (const file of files) {
    const bench: ApiGuardBenchmark = JSON.parse(fs.readFileSync(path.join(BENCH_DIR, file), 'utf-8'));
    const caseDir = path.join(FIXTURE_DIR, bench.id);

    if (!fs.existsSync(caseDir)) {
      console.log(`  SKIP  ${bench.id} (no fixture at ${path.relative(process.cwd(), caseDir)})`);
      continue;
    }

    const repo = await createBenchmarkRepo(caseDir);
    const checks: string[] = [];

    try {
      const engine = makeMockEngine(repo.root);
      const result = await apiGuard.handler(
        { scope: 'changed', ...bench.input } as any,
        engine,
      ) as any;

      // Check semver recommendation
      if (bench.expected.semver && result.summary.recommendedSemver !== bench.expected.semver) {
        checks.push(`semver: expected ${bench.expected.semver}, got ${result.summary.recommendedSemver}`);
      }

      // Check highest risk level (map benchmark high/medium/low to breaking/risky/safe)
      if (bench.expected.risk) {
        const expectedActual = RISK_MAP[bench.expected.risk] ?? bench.expected.risk;
        const hasRisk = result.entries.some((e: any) => e.risk === expectedActual);
        if (!hasRisk) {
          const actual = result.entries.map((e: any) => e.risk).join(', ') || 'none';
          checks.push(`risk: no entry with risk "${bench.expected.risk}" (${expectedActual}), got [${actual}]`);
        }
      }

      // Check explanation keywords across all entry fields (reason, kind, risk, structuralDiff)
      if (bench.expected.explanation_contains) {
        const text = JSON.stringify(result.entries).toLowerCase();
        for (const kw of bench.expected.explanation_contains) {
          if (!text.includes(kw.toLowerCase())) {
            checks.push(`explanation missing: "${kw}"`);
          }
        }
      }

      // Sanity: expect at least one entry for non-patch scenarios
      if (result.entries.length === 0 && bench.expected.semver && bench.expected.semver !== 'patch') {
        checks.push('no entries detected');
      }
    } catch (err: any) {
      checks.push(`error: ${err.message}`);
    } finally {
      await repo.cleanup();
    }

    if (checks.length === 0) {
      passed++;
      console.log(`  PASS  ${bench.id}`);
    } else {
      failed++;
      const msg = `  FAIL  ${bench.id}: ${checks.join(', ')}`;
      console.log(msg);
      failures.push(msg);
    }
  }

  console.log(`\n${passed + failed} benchmarks: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(f);
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
