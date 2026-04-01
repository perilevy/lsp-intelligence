#!/usr/bin/env npx tsx
/**
 * Benchmark runner for find_code.
 * Runs benchmark cases against the query parser and planner (no LSP needed).
 * Usage: npx tsx benchmarks/run.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseQuery } from '../src/search/query/parseQuery.js';
import { planQuery } from '../src/search/query/planQuery.js';

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

const BENCHMARK_DIR = path.resolve(import.meta.dirname, 'find-code');
const files = fs.readdirSync(BENCHMARK_DIR).filter((f) => f.endsWith('.json'));

let passed = 0;
let failed = 0;
const failures: string[] = [];

for (const file of files) {
  const bench: BenchmarkCase = JSON.parse(fs.readFileSync(path.join(BENCHMARK_DIR, file), 'utf-8'));
  const ir = parseQuery(bench.query);
  const plan = planQuery(ir);

  const checks: string[] = [];

  // Check mode
  if (bench.expected.mode && ir.mode !== bench.expected.mode) {
    checks.push(`mode: expected ${bench.expected.mode}, got ${ir.mode}`);
  }

  // Check retrievers present
  if (bench.expected.retrievers) {
    for (const r of bench.expected.retrievers) {
      if (!plan.retrievers.includes(r as any)) {
        checks.push(`retriever missing: ${r}`);
      }
    }
  }

  // Check retrievers absent
  if (bench.expected.notRetrievers) {
    for (const r of bench.expected.notRetrievers) {
      if (plan.retrievers.includes(r as any)) {
        checks.push(`unexpected retriever: ${r}`);
      }
    }
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
