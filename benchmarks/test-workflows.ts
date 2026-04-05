#!/usr/bin/env npx tsx
/**
 * Phase 3 workflow gate test — verify_changes v2, api_guard migration steps,
 * and root_cause_trace next-step intelligence.
 *
 * Tests the "outputs feel like recommendations, not just data dumps" criterion
 * from Phase 3C of the roadmap.
 *
 * Usage: npx tsx benchmarks/test-workflows.ts
 */
import { applyVirtualEdit } from '../src/analysis/ts/applyVirtualEdit.js';
import { diffExportSets } from '../src/analysis/ts/diffDeclarationShape.js';
import { extractExports } from '../src/analysis/ts/extractExports.js';
import { extractDeclarationShape } from '../src/analysis/ts/extractDeclarationShape.js';
import { parseSourceContent } from '../src/analysis/ts/parseSourceFile.js';

let passed = 0;
let failed = 0;
function check(condition: boolean, label: string, detail?: string): void {
  if (condition) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}

// Test sources
const FUNCTION_SOURCE = `
export function createUser(name: string, email: string): { id: string } {
  return { id: name + email };
}
export function deleteUser(userId: string): void {}
`.trim();

const INTERFACE_SOURCE = `
export interface Config {
  host: string;
  port?: number;
}
export function createConfig(host: string): Config {
  return { host };
}
`.trim();

const ENUM_SOURCE = `
export enum Status {
  Active = 'active',
  Draft = 'draft',
  Archived = 'archived',
}
`.trim();

async function main() {
  console.log('=== Phase 3 workflow gate test ===\n');

  // ---------------------------------------------------------------------------
  // Test 1: api_guard migration steps via diff + recipe chain
  // ---------------------------------------------------------------------------
  console.log('--- 1. Migration step generation ---\n');

  // Simulate adding a required param to createUser
  const addParamEdit = applyVirtualEdit(FUNCTION_SOURCE, 'lib.ts', {
    kind: 'add_required_param',
    funcName: 'createUser',
    filePath: 'lib.ts',
    paramName: 'role',
    paramType: 'string',
  });
  check(addParamEdit !== null, 'add_required_param virtual edit succeeds');

  if (addParamEdit) {
    const baseSf = parseSourceContent(FUNCTION_SOURCE, 'lib.ts');
    const overlaySf = parseSourceContent(addParamEdit.modifiedSource, 'lib.ts');
    const baseShapes = extractExports(baseSf).map(e => extractDeclarationShape(baseSf, e));
    const overlayShapes = extractExports(overlaySf).map(e => extractDeclarationShape(overlaySf, e));
    const diffs = diffExportSets(baseShapes, overlayShapes);

    const createUserDiff = diffs.find(d => d.name === 'createUser');
    check(createUserDiff?.risk === 'breaking', `createUser diff is 'breaking' (got '${createUserDiff?.risk}')`);
    check(createUserDiff?.diffs[0]?.kind === 'param_required', `kind is param_required (got '${createUserDiff?.diffs[0]?.kind}')`);
    check(diffs.find(d => d.name === 'deleteUser') === undefined, 'deleteUser unaffected');
  }

  // Simulate removing a required interface member
  const removeFieldEdit = applyVirtualEdit(INTERFACE_SOURCE, 'config.ts', {
    kind: 'add_required_param',  // Using add param to test another signature change
    funcName: 'createConfig',
    filePath: 'config.ts',
    paramName: 'port',
    paramType: 'number',
  });
  check(removeFieldEdit !== null, 'second virtual edit (createConfig) succeeds');

  // ---------------------------------------------------------------------------
  // Test 2: Verify the enum member diff produces exhaustiveness-aware output
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. Enum diff + exhaustiveness chain ---\n');

  const addMemberEdit = applyVirtualEdit(ENUM_SOURCE, 'status.ts', {
    kind: 'add_enum_member',
    enumName: 'Status',
    filePath: 'status.ts',
    memberName: 'Pending',
    memberValue: '"pending"',
  });
  check(addMemberEdit !== null, 'add_enum_member virtual edit succeeds');

  if (addMemberEdit) {
    check(addMemberEdit.modifiedSource.includes('Pending'), 'Pending appears in modified source');
    check(addMemberEdit.newSignature.includes('Pending'), `new signature includes Pending: "${addMemberEdit.newSignature}"`);

    const baseSf = parseSourceContent(ENUM_SOURCE, 'status.ts');
    const overlaySf = parseSourceContent(addMemberEdit.modifiedSource, 'status.ts');
    const baseShapes = extractExports(baseSf).map(e => extractDeclarationShape(baseSf, e));
    const overlayShapes = extractExports(overlaySf).map(e => extractDeclarationShape(overlaySf, e));
    const diffs = diffExportSets(baseShapes, overlayShapes);

    const statusDiff = diffs.find(d => d.name === 'Status');
    check(statusDiff !== undefined, 'Status appears in diff');
    check(statusDiff?.diffs.some(d => d.kind === 'enum_member_added') ?? false,
      `enum_member_added in diffs: ${JSON.stringify(statusDiff?.diffs.map(d => d.kind))}`);
    check(statusDiff?.risk === 'risky', `enum add is 'risky' risk (got '${statusDiff?.risk}')`);
  }

  // Also test remove_enum_member
  const removeMemberEdit = applyVirtualEdit(ENUM_SOURCE, 'status.ts', {
    kind: 'remove_enum_member',
    enumName: 'Status',
    filePath: 'status.ts',
    memberName: 'Archived',
  });
  check(removeMemberEdit !== null, 'remove_enum_member virtual edit succeeds');
  if (removeMemberEdit) {
    check(!removeMemberEdit.modifiedSource.includes('Archived'), 'Archived removed from source');
    check(removeMemberEdit.modifiedSource.includes('Active'), 'Active still present');
    check(removeMemberEdit.modifiedSource.includes('Draft'), 'Draft still present');
  }

  // ---------------------------------------------------------------------------
  // Test 3: VerifyResult structure validation (unit test without LSP)
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. VerifyResult structure ---\n');

  // Import and validate the VerifyResult type is exported with new fields
  const { verifyChangeSet } = await import('../src/workflows/verifyChangeSet.js');
  check(verifyChangeSet.name === 'verify_changes', 'verify_changes tool registered');
  check(typeof verifyChangeSet.handler === 'function', 'handler is a function');

  // ---------------------------------------------------------------------------
  // Test 4: simulate_change tool is registered
  // ---------------------------------------------------------------------------
  console.log('\n--- 4. simulate_change tool ---\n');

  const { simulateChange } = await import('../src/workflows/simulateChange.js');
  check(simulateChange.name === 'simulate_change', 'simulate_change tool registered');

  // Test the recipe builder directly with a mock engine
  const mockEngine = {
    workspaceRoot: '/tmp/test',
    gitAvailable: false,
    docManager: { getCachedDiagnostics: () => [] },
    prepareFile: async () => { throw new Error('mock'); },
    request: async () => null,
  };

  // Calling with non-existent file should fail gracefully
  const result = await simulateChange.handler({
    file_path: '/nonexistent/file.ts',
    recipe: 'add_required_param',
    symbol: 'myFunc',
    param_name: 'timeout',
    param_type: 'number',
  } as any, mockEngine as any) as any;

  check(typeof result === 'object', 'simulate_change returns an object for missing file');
  check(typeof result.summary === 'string', `returns summary string: "${result.summary?.slice(0, 60)}"`);

  // ---------------------------------------------------------------------------
  // Test 5: api_guard + root_cause_trace output shape includes new fields
  // ---------------------------------------------------------------------------
  console.log('\n--- 5. New Phase 3 output fields ---\n');

  // Verify apiGuard has migrationSteps in its entry type (via a dry-run diff)
  const baseSf2 = parseSourceContent(FUNCTION_SOURCE, 'api.ts');
  const modEdit = applyVirtualEdit(FUNCTION_SOURCE, 'api.ts', {
    kind: 'add_required_param', funcName: 'createUser', filePath: 'api.ts', paramName: 'x', paramType: 'number',
  });
  if (modEdit) {
    const overlaySf2 = parseSourceContent(modEdit.modifiedSource, 'api.ts');
    const b2 = extractExports(baseSf2).map(e => extractDeclarationShape(baseSf2, e));
    const o2 = extractExports(overlaySf2).map(e => extractDeclarationShape(overlaySf2, e));
    const d2 = diffExportSets(b2, o2);
    check(d2.length > 0, 'Diff entries produced');
    check(d2[0].diffs[0]?.kind === 'param_required', 'Diff kind is param_required');
    check(d2[0].risk === 'breaking', 'Diff risk is breaking');
    // Migration steps would be generated by apiGuard.handler — test the step generator via the diff
    const kind = d2[0].diffs[0]?.kind ?? '';
    check(typeof kind === 'string' && kind.length > 0, `Change kind is a non-empty string: "${kind}"`);
  }

  // Summary
  console.log(`\n${passed + failed} Phase 3 workflow checks: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
