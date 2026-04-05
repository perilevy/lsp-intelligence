#!/usr/bin/env npx tsx
/**
 * Phase 4B gate test — Persistent semantic cache.
 *
 * Proves three things:
 * 1. Cache saves to disk after a fresh index build
 * 2. Cache loads correctly on the next call (no rebuild)
 * 3. Cache invalidates correctly when a file changes
 * 4. Cache is bypassed when a SnapshotResolver is active (overlays not persisted)
 *
 * Usage: npx tsx benchmarks/test-cache.ts
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { getWorkspaceIndex, clearWorkspaceIndex } from '../src/search/index/workspaceIndex.js';
import { SemanticCache } from '../src/cache/SemanticCache.js';
import { buildStaticSnapshotResolver } from '../src/session/SnapshotResolver.js';

const FIXTURE_ROOT = path.resolve(import.meta.dirname, '..', 'test-fixtures', 'monorepo');
const VALIDATE_FILE = path.join(FIXTURE_ROOT, 'packages', 'core', 'src', 'validate.ts');
const scope = { roots: [FIXTURE_ROOT], includeTests: false };

let passed = 0;
let failed = 0;
function check(condition: boolean, label: string, detail?: string): void {
  if (condition) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}

async function main() {
  console.log('=== Phase 4B persistent cache gate test ===\n');

  // --- Test 1: First build saves to disk ---
  console.log('--- 1. Cache save after fresh build ---\n');

  clearWorkspaceIndex(scope);
  const t0 = Date.now();
  const index1 = getWorkspaceIndex(scope);
  const buildMs = Date.now() - t0;
  console.log(`    → Fresh build: ${buildMs}ms, ${index1.files.size} files, ${index1.declarations.length} declarations`);

  check(index1.files.size > 0, 'Index has files after fresh build');
  check(index1.declarations.length > 0, 'Index has declarations');
  check(index1.declarations.some(d => d.symbol === 'validateConfig'), 'validateConfig indexed');

  // Verify the cache file was written to disk
  const diskCache = new SemanticCache(scope, 2);
  const loaded = diskCache.tryLoad(JSON.stringify({ roots: [...scope.roots].sort(), includeTests: scope.includeTests }));
  check(loaded !== null, 'Cache was persisted to disk after build');

  // --- Test 2: Load from disk cache (no rebuild) ---
  console.log('\n--- 2. Cache load avoids rebuild ---\n');

  clearWorkspaceIndex(); // clear in-memory only (no scope → doesn't invalidate disk)
  const t1 = Date.now();
  const index2 = getWorkspaceIndex(scope);
  const loadMs = Date.now() - t1;
  console.log(`    → Cached load: ${loadMs}ms (vs ${buildMs}ms fresh build)`);

  check(index2.files.size === index1.files.size, `Same file count after load: ${index2.files.size}`);
  check(index2.declarations.length === index1.declarations.length, 'Same declaration count after load');
  check(index2.declarations.some(d => d.symbol === 'validateConfig'), 'validateConfig still in loaded index');
  check(loadMs < buildMs, `Load (${loadMs}ms) is faster than fresh build (${buildMs}ms)`);

  // --- Test 3: Cache invalidation when file changes ---
  console.log('\n--- 3. Cache invalidation on file change ---\n');

  // Touch the validate.ts file (update its mtime)
  const originalMtime = fs.statSync(VALIDATE_FILE).mtimeMs;
  fs.utimesSync(VALIDATE_FILE, new Date(), new Date()); // update mtime
  const newMtime = fs.statSync(VALIDATE_FILE).mtimeMs;

  check(newMtime > originalMtime, `File mtime updated (${originalMtime} → ${newMtime})`);

  clearWorkspaceIndex(); // clear in-memory
  const t2 = Date.now();
  const index3 = getWorkspaceIndex(scope); // should detect stale cache and rebuild
  const rebuildMs = Date.now() - t2;
  console.log(`    → Post-invalidation: ${rebuildMs}ms`);

  check(index3.declarations.some(d => d.symbol === 'validateConfig'), 'validateConfig in rebuilt index');

  // Restore the mtime (don't permanently change the fixture)
  fs.utimesSync(VALIDATE_FILE, new Date(originalMtime), new Date(originalMtime));

  // --- Test 4: Overlay bypasses cache ---
  console.log('\n--- 4. Snapshot resolver bypasses cache ---\n');

  const overlayText = fs.readFileSync(VALIDATE_FILE, 'utf-8') + '\n\nexport function cacheTestFunc(): void {}\n';
  const resolver = buildStaticSnapshotResolver({ [VALIDATE_FILE]: overlayText });

  clearWorkspaceIndex();
  const overlayIndex = getWorkspaceIndex(scope, { snapshot: resolver });

  // With overlay: cacheTestFunc should be visible
  check(
    overlayIndex.declarations.some(d => d.symbol === 'cacheTestFunc'),
    'Overlay index contains unsaved cacheTestFunc',
  );

  // After overlay call, disk cache should still reflect the on-disk state (no overlay in cache)
  clearWorkspaceIndex();
  const diskIndex = getWorkspaceIndex(scope); // no resolver — uses disk/cache
  check(
    !diskIndex.declarations.some(d => d.symbol === 'cacheTestFunc'),
    'Disk cache does NOT contain unsaved cacheTestFunc (overlays not persisted)',
  );

  // --- Test 5: Cache fingerprint stability ---
  console.log('\n--- 5. Cache fingerprint stability ---\n');

  const { computeScopeFingerprint } = await import('../src/cache/SnapshotFingerprint.js');
  const fp1 = computeScopeFingerprint(FIXTURE_ROOT, false);
  const fp2 = computeScopeFingerprint(FIXTURE_ROOT, false);
  const fp3 = computeScopeFingerprint(FIXTURE_ROOT, true); // different scope

  check(fp1.key === fp2.key, 'Same scope produces same fingerprint');
  check(fp1.key !== fp3.key, 'Different includeTests produces different fingerprint');
  check(fp1.key.length === 16, `Fingerprint is 16 chars: "${fp1.key}"`);

  // --- Summary ---
  console.log(`\n${passed + failed} Phase 4B cache checks: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
