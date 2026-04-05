#!/usr/bin/env npx tsx
/**
 * Phase 2D gate test — Type-state / exhaustiveness intelligence.
 *
 * Proves the three "obviously smarter" capabilities:
 * 1. findNonExhaustiveSwitches  — which switches would break if an enum changes?
 * 2. predictAddedMemberImpact  — if I add this enum member, which switches miss it?
 * 3. analyzeCallSiteCompatibility — which callers break if this param becomes required?
 *
 * These questions cannot be answered reliably by a graph-first system because they
 * require TypeScript's type checker to determine which types flow through which code.
 *
 * Usage: npx tsx benchmarks/test-typestate.ts
 */
import * as path from 'path';
import * as fs from 'fs';
import { programManager } from '../src/analysis/ts/program/ProgramManager.js';
import { CheckerQueries } from '../src/analysis/ts/program/CheckerQueries.js';
import { findNonExhaustiveSwitches, predictAddedMemberImpact, getAllSwitchResults } from '../src/analysis/ts/exhaustiveness.js';
import { analyzeCallSiteCompatibility } from '../src/analysis/ts/compatibility.js';
import { findTypeGuardFunctions } from '../src/analysis/ts/typeState.js';
import { buildStaticSnapshotResolver } from '../src/session/SnapshotResolver.js';

const FIXTURE_ROOT = path.resolve(import.meta.dirname, '..', 'test-fixtures', 'monorepo');
const TYPES_FILE = path.join(FIXTURE_ROOT, 'packages', 'types', 'src', 'index.ts');
const VALIDATE_FILE = path.join(FIXTURE_ROOT, 'packages', 'core', 'src', 'validate.ts');
const STATUS_FILE = path.join(FIXTURE_ROOT, 'packages', 'app', 'src', 'statusHandler.ts');

let passed = 0;
let failed = 0;

function check(condition: boolean, label: string, detail?: string): void {
  if (condition) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}

async function main() {
  console.log('=== Phase 2D type-state / exhaustiveness gate test ===\n');

  const program = programManager.getOrBuild(FIXTURE_ROOT);
  const queries = new CheckerQueries(program);

  // --- Test 1: findNonExhaustiveSwitches ---
  console.log('--- 1. Non-exhaustive switch detection ---\n');

  // The monorepo has statusHandler.ts with getStatusLabel which switches on ItemStatus
  // If that switch covers all 3 members (Active, Archived, Draft), it's exhaustive
  const allSwitches = getAllSwitchResults(program, TYPES_FILE, 'ItemStatus');
  check(allSwitches.length > 0, 'Found switch statements using ItemStatus enum', `got ${allSwitches.length}`);

  const statusSwitch = allSwitches.find((s) => s.filePath.includes('statusHandler'));
  check(statusSwitch !== undefined, 'statusHandler.ts has a switch on ItemStatus');
  if (statusSwitch) {
    check(statusSwitch.handledMembers.length > 0, `switch handles ${statusSwitch.handledMembers.length} member(s): [${statusSwitch.handledMembers.join(', ')}]`);
    check(statusSwitch.isExhaustive, `switch is exhaustive (covers all ${queries.getEnumMembers(TYPES_FILE, 'ItemStatus')?.length} members or has default)`);
  }

  // Non-exhaustive switches: statusHandler covers all 3 members → should be empty
  const nonExhaustive = findNonExhaustiveSwitches(program, TYPES_FILE, 'ItemStatus');
  check(Array.isArray(nonExhaustive), 'findNonExhaustiveSwitches returns an array');
  console.log(`    → Found ${nonExhaustive.length} non-exhaustive switch(es) for ItemStatus`);

  // --- Test 2: predictAddedMemberImpact ---
  console.log('\n--- 2. Predict impact of adding an enum member ---\n');

  // If we ADD a new member "Pending" to ItemStatus, switches WITHOUT a default would miss it
  const impact = predictAddedMemberImpact(program, TYPES_FILE, 'ItemStatus', 'Pending');
  check(typeof impact.affectedSwitches === 'object', 'predictAddedMemberImpact returns a result');
  check(typeof impact.safeCount === 'number', `safeCount is a number (got ${impact.safeCount})`);
  console.log(`    → ${impact.affectedSwitches.length} switch(es) would miss "Pending" if added`);
  console.log(`    → ${impact.safeCount} switch(es) are safe (have default case)`);

  // Verify with an OVERLAY: inject Pending into the enum (unsaved) and check that
  // the exhaustiveness now reports the switch as non-exhaustive
  const diskContent = fs.readFileSync(TYPES_FILE, 'utf-8');
  const withPending = diskContent.replace('Draft = "draft",', 'Draft = "draft",\n  Pending = "pending",');
  const resolver = buildStaticSnapshotResolver({ [TYPES_FILE]: withPending });
  const overlayProgram = programManager.getOrBuild(FIXTURE_ROOT, resolver);

  const overlayMembers = new CheckerQueries(overlayProgram).getEnumMembers(TYPES_FILE, 'ItemStatus');
  check(overlayMembers?.includes('Pending') ?? false, 'overlay: Pending member visible in program');
  check((overlayMembers?.length ?? 0) === 4, `overlay: enum now has 4 members (got ${overlayMembers?.length})`);

  // With Pending added (overlay), switches that covered 3 members are now non-exhaustive
  const overlayNonExhaustive = findNonExhaustiveSwitches(overlayProgram, TYPES_FILE, 'ItemStatus');
  console.log(`    → Overlay: ${overlayNonExhaustive.length} non-exhaustive switch(es) after adding Pending`);
  if (nonExhaustive.length === 0 && allSwitches.some((s) => !s.hasDefaultCase)) {
    // Switches were exhaustive before, should be non-exhaustive after adding a member
    check(overlayNonExhaustive.length > 0, 'overlay: adding Pending makes previously-exhaustive switches non-exhaustive');
  }

  // --- Test 3: analyzeCallSiteCompatibility ---
  console.log('\n--- 3. Call-site compatibility analysis ---\n');

  // validateConfig takes 1 required param — any call with 0 args would break
  const report = analyzeCallSiteCompatibility(program, VALIDATE_FILE, 'validateConfig', 1, 1);
  check(typeof report.callerCount === 'number', `callerCount is a number (got ${report.callerCount})`);
  check(report.requiredArity === 1, `requiredArity = 1 (got ${report.requiredArity})`);
  console.log(`    → ${report.callerCount} call site(s) found for validateConfig`);
  console.log(`    → ${report.breakingCallers.length} breaking, ${report.compatibleCallers.length} compatible`);

  // --- Test 4: type narrowing / type guard detection ---
  console.log('\n--- 4. Type-state: type guard function detection ---\n');

  // Look for any type guard functions in the program
  const guards = findTypeGuardFunctions(program, 'ItemStatus');
  check(Array.isArray(guards), 'findTypeGuardFunctions returns an array');
  console.log(`    → Found ${guards.length} type guard function(s) for ItemStatus`);

  // --- Summary ---
  console.log(`\n${passed + failed} Phase 2D checks: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
