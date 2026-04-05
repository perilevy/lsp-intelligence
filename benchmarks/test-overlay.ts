#!/usr/bin/env npx tsx
/**
 * Phase 2A gate test — Unsaved-buffer overlay behavior.
 *
 * Proves that find_code reflects in-memory document edits that have NOT been
 * saved to disk. This is the core Phase 2A acceptance requirement.
 *
 * Strategy: use buildStaticSnapshotResolver (no LspEngine needed) to inject
 * a fake overlay for a fixture file, then verify getWorkspaceIndex produces
 * index entries from the overlay text rather than the on-disk content.
 *
 * Usage: npx tsx benchmarks/test-overlay.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { buildStaticSnapshotResolver } from '../src/session/SnapshotResolver.js';
import { getWorkspaceIndex, clearWorkspaceIndex } from '../src/search/index/workspaceIndex.js';
import type { SearchScope } from '../src/search/types.js';

const FIXTURE_ROOT = path.resolve(import.meta.dirname, '..', 'test-fixtures', 'monorepo');
const TARGET_FILE = path.join(FIXTURE_ROOT, 'packages', 'core', 'src', 'validate.ts');

function check(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`  FAIL  ${message}`);
    process.exit(1);
  }
  console.log(`  PASS  ${message}`);
}

async function main() {
  console.log('=== Phase 2A overlay test ===\n');

  const scope: SearchScope = { roots: [FIXTURE_ROOT], includeTests: false };

  // --- Baseline: index without overlay ---
  clearWorkspaceIndex();
  const baseIndex = getWorkspaceIndex(scope);
  const baseDecls = baseIndex.declarations.map((d) => d.symbol);

  check(baseDecls.includes('validateConfig'), 'baseline: validateConfig indexed from disk');
  check(!baseDecls.includes('checkSuperAdmin'), 'baseline: checkSuperAdmin NOT in index (not on disk)');

  // --- Overlay: inject unsaved edit that adds a new export ---
  const diskContent = fs.readFileSync(TARGET_FILE, 'utf-8');
  const overlayContent = `${diskContent}\n\n/** Added in unsaved edit — Phase 2A overlay test */\nexport function checkSuperAdmin(role: string): boolean {\n  return role === 'superadmin';\n}\n`;

  const resolver = buildStaticSnapshotResolver({ [TARGET_FILE]: overlayContent });

  // Force a fresh index with the overlay (dirty file bypasses mtime cache)
  clearWorkspaceIndex();
  const overlayIndex = getWorkspaceIndex(scope, { snapshot: resolver });
  const overlayDecls = overlayIndex.declarations.map((d) => d.symbol);

  check(overlayDecls.includes('checkSuperAdmin'), 'overlay: checkSuperAdmin found from unsaved edit');
  check(overlayDecls.includes('validateConfig'), 'overlay: validateConfig still present alongside overlay');

  // --- Verify overlay doesn't contaminate subsequent calls without snapshot ---
  clearWorkspaceIndex();
  const diskIndex = getWorkspaceIndex(scope);
  const diskDecls = diskIndex.declarations.map((d) => d.symbol);

  check(!diskDecls.includes('checkSuperAdmin'), 'no-overlay: checkSuperAdmin absent when snapshot not passed');
  check(diskDecls.includes('validateConfig'), 'no-overlay: validateConfig still indexed from disk');

  console.log('\n3 Phase 2A overlay checks: 3 passed, 0 failed');
}

main().catch((err) => { console.error(err); process.exit(1); });
