#!/usr/bin/env npx tsx
/**
 * Root cause trace benchmark runner.
 *
 * For each fixture JSON in benchmarks/root-cause/, looks for a matching case
 * directory under test-fixtures/benchmarks/root-cause/<id>/ with base/ and head/
 * subdirectories. Creates a temporary git repo (base committed, head in working
 * tree), initializes a real LspEngine for TypeScript diagnostics, and runs
 * root_cause_trace with the base SHA so git-based change detection is active.
 *
 * Temporarily symlinks the project's TypeScript into each fixture's node_modules
 * so typescript-language-server can find it, then cleans up after the test.
 *
 * Usage: npx tsx benchmarks/run-root-cause.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { createBenchmarkRepo } from './lib/createBenchmarkRepo.js';
import { rootCauseTrace } from '../src/tools/composites/rootCauseTrace.js';
import { LspEngine } from '../src/engine/LspEngine.js';

interface RootCauseBenchmark {
  id: string;
  category: string;
  description: string;
  fixture: string;
  input: { symbol?: string; file_path?: string; line?: number; diagnostic_code?: string };
  expected: {
    topCandidateFile?: string;
    explanation_contains?: string[];
    confidence_floor?: 'low' | 'medium' | 'high';
  };
  notes?: string;
}

const CONFIDENCE_ORDER = ['low', 'medium', 'high'];

/**
 * Temporarily symlink the project's TypeScript into a fixture directory so that
 * typescript-language-server can find it via LspEngine.buildInitOptions().
 * Returns a cleanup function.
 */
function linkTypescript(fixtureDir: string): () => void {
  const projectTs = path.resolve(import.meta.dirname, '..', 'node_modules', 'typescript');
  const nodeModsDir = path.join(fixtureDir, 'node_modules');
  const tsLink = path.join(nodeModsDir, 'typescript');

  if (fs.existsSync(tsLink)) return () => {};

  fs.mkdirSync(nodeModsDir, { recursive: true });
  fs.symlinkSync(projectTs, tsLink);

  return () => {
    try { fs.unlinkSync(tsLink); } catch {}
    try { fs.rmdirSync(nodeModsDir); } catch {}
  };
}

async function main() {
  const BENCH_DIR = path.resolve(import.meta.dirname, 'root-cause');
  const FIXTURE_DIR = path.resolve(import.meta.dirname, '..', 'test-fixtures', 'benchmarks', 'root-cause');

  const files = fs.readdirSync(BENCH_DIR).filter((f) => f.endsWith('.json'));

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  console.log('=== Root Cause Trace benchmarks ===\n');

  for (const file of files) {
    const bench: RootCauseBenchmark = JSON.parse(fs.readFileSync(path.join(BENCH_DIR, file), 'utf-8'));
    const caseDir = path.join(FIXTURE_DIR, bench.id);

    if (!fs.existsSync(caseDir)) {
      console.log(`  SKIP  ${bench.id} (no fixture at ${path.relative(process.cwd(), caseDir)})`);
      continue;
    }

    const repo = await createBenchmarkRepo(caseDir);
    const unlinkTs = linkTypescript(repo.root);
    const checks: string[] = [];
    let engine: LspEngine | null = null;

    try {
      engine = new LspEngine(repo.root);
      await engine.initialize();

      // Resolve file_path to absolute before waiting for diagnostics
      const targetFile = bench.input.file_path
        ? path.join(repo.root, bench.input.file_path)
        : undefined;

      // Wait for LSP to index and produce diagnostics on the error file
      if (targetFile) {
        await engine.prepareFile(targetFile).catch(() => {});
        // Poll for the expected diagnostic to appear (up to 15s)
        const { waitForDiagnostics } = await import('../src/engine/waitForDiagnostics.js');
        const { pathToUri } = await import('../src/engine/positions.js');
        await waitForDiagnostics(engine.docManager, pathToUri(targetFile), 800);
        // Extra wait for slower machines
        let attempts = 0;
        while (attempts < 20) {
          const diags = engine.docManager.getCachedDiagnostics(pathToUri(targetFile));
          if (diags.some((d: any) => d.severity === 1)) break;
          await new Promise((r) => setTimeout(r, 500));
          attempts++;
        }
      }

      // Build input: resolve file_path to absolute, pass base SHA for git-aware tracing
      const input: any = {
        ...bench.input,
        base: repo.baseSha,
      };
      if (input.file_path) {
        input.file_path = path.join(repo.root, bench.input.file_path!);
      }

      const result = await rootCauseTrace.handler(input, engine) as any;

      if (result.candidates.length === 0) {
        const warnings = result.warnings?.join('; ') ?? '';
        checks.push(`no candidates returned (warnings: ${warnings})`);
      } else {
        const top = result.topCandidate ?? result.candidates[0];

        // Check top candidate file
        if (bench.expected.topCandidateFile) {
          const rel = top.filePath?.replace(repo.root + '/', '').replace(repo.root + path.sep, '') ?? '';
          if (!rel.includes(bench.expected.topCandidateFile) && !top.filePath?.includes(bench.expected.topCandidateFile)) {
            checks.push(`topCandidateFile: expected to contain "${bench.expected.topCandidateFile}", got "${rel}"`);
          }
        }

        // Check confidence floor
        if (bench.expected.confidence_floor) {
          const floor = CONFIDENCE_ORDER.indexOf(bench.expected.confidence_floor);
          const actual = CONFIDENCE_ORDER.indexOf(top.confidence ?? 'low');
          if (actual < floor) {
            checks.push(`confidence: expected >= ${bench.expected.confidence_floor}, got ${top.confidence}`);
          }
        }

        // Check explanation keywords across reason + evidence array
        if (bench.expected.explanation_contains) {
          const text = ((top.reason ?? '') + ' ' + (top.evidence ?? []).join(' ') + ' ' + (top.structuralChange ?? '')).toLowerCase();
          for (const kw of bench.expected.explanation_contains) {
            if (!text.includes(kw.toLowerCase())) {
              checks.push(`explanation missing: "${kw}" (text: ${text.slice(0, 120)})`);
            }
          }
        }
      }
    } catch (err: any) {
      checks.push(`error: ${err.message}`);
    } finally {
      if (engine) await engine.shutdown().catch(() => {});
      unlinkTs();
      await repo.cleanup();
    }

    if (checks.length === 0) {
      passed++;
      console.log(`  PASS  ${bench.id}`);
    } else {
      failed++;
      const msg = `  FAIL  ${bench.id}: ${checks.join('; ')}`;
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
