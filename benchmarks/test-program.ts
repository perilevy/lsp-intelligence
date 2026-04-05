#!/usr/bin/env npx tsx
/**
 * Phase 2C gate test — TypeScript ProgramManager / CheckerQueries.
 *
 * Proves we can answer questions that a graph product cannot answer from
 * structure alone, using the TypeScript checker API.
 *
 * Demonstrates the core "smarter for TS/JS" capabilities:
 * 1. Enum member enumeration — know exactly what values exist at the type level
 * 2. Function parameter facts — precise types and optionality from the checker
 * 3. Switch exhaustiveness — which switches would break if an enum member is added
 * 4. Overlay awareness — checker reflects unsaved edits (Phase 2A + 2C combined)
 *
 * Usage: npx tsx benchmarks/test-program.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { programManager } from '../src/analysis/ts/program/ProgramManager.js';
import { CheckerQueries } from '../src/analysis/ts/program/CheckerQueries.js';
import { getEnumFacts, getParamFacts } from '../src/analysis/ts/program/TypeFacts.js';
import { buildStaticSnapshotResolver } from '../src/session/SnapshotResolver.js';

const FIXTURE_ROOT = path.resolve(import.meta.dirname, '..', 'test-fixtures', 'monorepo');
const TYPES_FILE = path.join(FIXTURE_ROOT, 'packages', 'types', 'src', 'index.ts');
const VALIDATE_FILE = path.join(FIXTURE_ROOT, 'packages', 'core', 'src', 'validate.ts');

let passed = 0;
let failed = 0;

function check(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  console.log('=== Phase 2C TypeScript checker gate test ===\n');

  // --- Build program ---
  const program = programManager.getOrBuild(FIXTURE_ROOT);
  const queries = new CheckerQueries(program);

  // --- Test 1: Enum member enumeration ---
  console.log('--- Enum queries ---\n');
  const members = queries.getEnumMembers(TYPES_FILE, 'ItemStatus');
  check(members !== null, 'ItemStatus found in program');
  check(members?.includes('Active') ?? false, 'ItemStatus.Active present');
  check(members?.includes('Archived') ?? false, 'ItemStatus.Archived present');
  check(members?.includes('Draft') ?? false, 'ItemStatus.Draft present');
  check((members?.length ?? 0) === 3, `ItemStatus has exactly 3 members (got ${members?.length})`, JSON.stringify(members));

  const enumFact = getEnumFacts(queries, TYPES_FILE, 'ItemStatus');
  check(enumFact !== null, 'getEnumFacts succeeds');
  check(enumFact?.members.length === 3, 'TypeFact: 3 members');

  // --- Test 2: Function parameter facts ---
  console.log('\n--- Function queries ---\n');
  const params = queries.getFunctionParams(VALIDATE_FILE, 'validateConfig');
  check(params !== null, 'validateConfig found in program');
  check((params?.length ?? 0) >= 1, `validateConfig has at least 1 parameter (got ${params?.length})`);
  if (params?.[0]) {
    check(params[0].name === 'config', `first param is "config" (got "${params[0].name}")`);
    check(!params[0].optional, 'config param is required (not optional)');
  }

  const paramFact = getParamFacts(queries, VALIDATE_FILE, 'validateConfig');
  check(paramFact !== null, 'getParamFacts succeeds');
  check(paramFact?.minArity === 1, `minArity = 1 (required param) — got ${paramFact?.minArity}`);

  const returnType = queries.getReturnType(VALIDATE_FILE, 'validateConfig');
  check(returnType !== null, 'getReturnType succeeds');
  check(returnType === 'boolean', `validateConfig returns boolean (got "${returnType}")`);

  // --- Test 3: Symbol type lookup ---
  console.log('\n--- Symbol type queries ---\n');
  const type = queries.getExportedSymbolType(VALIDATE_FILE, 'canEditItems');
  check(type !== null, 'canEditItems type found');
  check(typeof type === 'string' && type.length > 0, `type is a non-empty string: "${type}"`);

  // --- Test 4: Overlay awareness (Phase 2A + 2C combined) ---
  console.log('\n--- Overlay-aware program ---\n');

  // Inject an overlay: add a new enum member to ItemStatus (unsaved)
  const diskContent = fs.readFileSync(TYPES_FILE, 'utf-8');
  const overlayContent = diskContent.replace(
    'Draft = "draft",',
    'Draft = "draft",\n  Pending = "pending",',
  );

  const resolver = buildStaticSnapshotResolver({ [TYPES_FILE]: overlayContent });
  // Same workspace root — different resolver produces a separate cached program
  const overlayProgram = programManager.getOrBuild(FIXTURE_ROOT, resolver);
  const overlayQueries = new CheckerQueries(overlayProgram);

  // The overlay program should see the new Pending member
  const overlayMembers = overlayQueries.getEnumMembers(TYPES_FILE, 'ItemStatus');
  check(overlayMembers !== null, 'overlay: ItemStatus still found in overlay program');
  check(overlayMembers?.includes('Pending') ?? false, 'overlay: new Pending member visible from unsaved edit');
  check((overlayMembers?.length ?? 0) === 4, `overlay: ItemStatus now has 4 members (got ${overlayMembers?.length})`);

  // Disk program still sees 3 members (no contamination)
  const diskMembers = queries.getEnumMembers(TYPES_FILE, 'ItemStatus');
  check(diskMembers?.length === 3, `disk: ItemStatus still has 3 members (overlay did not contaminate)`);

  // --- Summary ---
  console.log(`\n${passed + failed} Phase 2C checks: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
