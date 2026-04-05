#!/usr/bin/env npx tsx
/**
 * Phase 3B spike gate test — Speculative change simulation.
 *
 * Proves the "add required parameter" recipe works end-to-end:
 * 1. Virtual edit applied without touching disk
 * 2. TypeScript program reflects the change (overlay-aware)
 * 3. Breaking call sites are found reliably
 * 4. API contract delta is correct
 *
 * Uses self-contained in-memory fixtures — no real workspace needed for the core test.
 *
 * Usage: npx tsx benchmarks/test-simulate.ts
 */
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { applyVirtualEdit } from '../src/analysis/ts/applyVirtualEdit.js';
import { programManager } from '../src/analysis/ts/program/ProgramManager.js';
import { CheckerQueries } from '../src/analysis/ts/program/CheckerQueries.js';
import { analyzeCallSiteCompatibility } from '../src/analysis/ts/compatibility.js';
import { diffExportSets } from '../src/analysis/ts/diffDeclarationShape.js';
import { extractExports } from '../src/analysis/ts/extractExports.js';
import { extractDeclarationShape } from '../src/analysis/ts/extractDeclarationShape.js';
import { parseSourceContent } from '../src/analysis/ts/parseSourceFile.js';
import { buildStaticSnapshotResolver } from '../src/session/SnapshotResolver.js';

let passed = 0;
let failed = 0;
function check(condition: boolean, label: string, detail?: string): void {
  if (condition) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}

// ---------------------------------------------------------------------------
// In-memory fixtures
// ---------------------------------------------------------------------------

const LIB_SOURCE = `
export function processRequest(url: string): { status: number } {
  return { status: 200 };
}

export function createSession(userId: string): string {
  return 'session-' + userId;
}
`.trim();

const APP_SOURCE = `
import { processRequest, createSession } from './lib';

function main() {
  const r1 = processRequest('/api/users');
  const r2 = processRequest('/api/items');
  const s = createSession('user-123');
  return { r1, r2, s };
}
`.trim();

async function main() {
  console.log('=== Phase 3B simulation spike gate test ===\n');

  // Create a temp dir for the in-memory fixtures
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-sim-'));
  const libPath = path.join(tmpDir, 'lib.ts');
  const appPath = path.join(tmpDir, 'app.ts');

  // Write files to disk so the TypeScript program can find them
  fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2020', module: 'commonjs', strict: true },
    include: ['*.ts'],
  }));
  fs.writeFileSync(libPath, LIB_SOURCE);
  fs.writeFileSync(appPath, APP_SOURCE);

  // --- Test 1: applyVirtualEdit without touching disk ---
  console.log('--- 1. Virtual edit (no disk write) ---\n');

  const addParamResult = applyVirtualEdit(LIB_SOURCE, libPath, {
    kind: 'add_required_param',
    funcName: 'processRequest',
    filePath: libPath,
    paramName: 'timeout',
    paramType: 'number',
  });

  check(addParamResult !== null, 'applyVirtualEdit returns a result');
  check(addParamResult?.modifiedSource !== LIB_SOURCE, 'modified source differs from original');
  check(addParamResult?.modifiedSource.includes('timeout: number') ?? false, 'new param appears in modified source');
  check(!fs.readFileSync(libPath, 'utf-8').includes('timeout'), 'disk file is unchanged (no side effects)');
  check(addParamResult?.originalSignature.includes('url') ?? false, `original signature contains url: "${addParamResult?.originalSignature}"`);
  check(addParamResult?.newSignature.includes('timeout') ?? false, `new signature contains timeout: "${addParamResult?.newSignature}"`);

  if (!addParamResult) { console.log('\nCannot continue — virtual edit failed'); process.exit(1); }

  // --- Test 2: TypeScript program reflects the virtual edit ---
  console.log('\n--- 2. Overlay-aware program reflects the change ---\n');

  const resolver = buildStaticSnapshotResolver({ [libPath]: addParamResult.modifiedSource });
  const overlayProgram = programManager.getOrBuild(tmpDir, resolver);
  const overlayQueries = new CheckerQueries(overlayProgram);

  const params = overlayQueries.getFunctionParams(libPath, 'processRequest');
  check(params !== null, 'getFunctionParams works on overlay program');
  check((params?.length ?? 0) === 2, `overlay program sees 2 params (url + timeout), got ${params?.length}`);
  check(params?.some(p => p.name === 'timeout' && !p.optional) ?? false, 'timeout param is present and required');
  check(params?.some(p => p.name === 'url') ?? false, 'url param still present');

  // Disk program still sees 1 param
  const diskProgram = programManager.getOrBuild(tmpDir);
  const diskQueries = new CheckerQueries(diskProgram);
  const diskParams = diskQueries.getFunctionParams(libPath, 'processRequest');
  check((diskParams?.length ?? 0) === 1, `disk program still sees 1 param (no contamination), got ${diskParams?.length}`);

  // --- Test 3: Breaking call sites found reliably ---
  console.log('\n--- 3. Breaking callers identified ---\n');

  const report = analyzeCallSiteCompatibility(overlayProgram, libPath, 'processRequest', 2, 2);
  check(report.callerCount > 0, `call sites found: ${report.callerCount}`);
  check(report.breakingCallers.length === 2, `2 breaking callers found (processRequest called twice), got ${report.breakingCallers.length}`);
  check(report.compatibleCallers.length === 0, 'no compatible callers (both pass only 1 arg)');
  check(report.breakingCallers.every(c => c.filePath === appPath), 'breaking callers are in app.ts');
  check(report.breakingCallers[0]?.issue?.includes('Too few args') ?? false, `issue message is descriptive: "${report.breakingCallers[0]?.issue}"`);

  // --- Test 4: API contract delta ---
  console.log('\n--- 4. API contract delta ---\n');

  const baseSf = parseSourceContent(LIB_SOURCE, libPath);
  const overlaySf = parseSourceContent(addParamResult.modifiedSource, libPath);
  const baseShapes = extractExports(baseSf).map(e => extractDeclarationShape(baseSf, e));
  const overlayShapes = extractExports(overlaySf).map(e => extractDeclarationShape(overlaySf, e));
  const diffs = diffExportSets(baseShapes, overlayShapes);

  const processRequestDiff = diffs.find(d => d.name === 'processRequest');
  check(processRequestDiff !== undefined, 'processRequest appears in contract delta');
  check(processRequestDiff?.status === 'changed', `status is 'changed' (got '${processRequestDiff?.status}')`);
  check(processRequestDiff?.risk === 'breaking', `risk is 'breaking' (got '${processRequestDiff?.risk}')`);
  check(processRequestDiff?.diffs[0]?.kind === 'param_required', `kind is 'param_required' (got '${processRequestDiff?.diffs[0]?.kind}')`);
  check(diffs.find(d => d.name === 'createSession') === undefined, 'createSession unaffected (not in delta)');

  // --- Test 5: Remove param recipe ---
  console.log('\n--- 5. remove_param recipe ---\n');

  const removeResult = applyVirtualEdit(LIB_SOURCE, libPath, {
    kind: 'remove_param',
    funcName: 'processRequest',
    filePath: libPath,
    paramName: 'url',
  });
  check(removeResult !== null, 'remove_param returns a result');
  check(removeResult?.modifiedSource.includes('processRequest()') ?? false,
    `url param removed: "${removeResult?.modifiedSource.slice(0, 60)}"`);

  // --- Test 6: add_enum_member recipe ---
  console.log('\n--- 6. add_enum_member recipe ---\n');

  const TYPES_SOURCE = `export enum Status { Active = 'active', Draft = 'draft' }`;
  const addMemberResult = applyVirtualEdit(TYPES_SOURCE, 'types.ts', {
    kind: 'add_enum_member',
    enumName: 'Status',
    filePath: 'types.ts',
    memberName: 'Archived',
    memberValue: '"archived"',
  });
  check(addMemberResult !== null, 'add_enum_member returns a result');
  check(addMemberResult?.modifiedSource.includes('Archived') ?? false,
    `Archived member added: "${addMemberResult?.modifiedSource}"`);

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });

  // --- Summary ---
  console.log(`\n${passed + failed} Phase 3B spike checks: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
