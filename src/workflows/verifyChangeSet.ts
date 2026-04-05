import { z } from 'zod';
import { defineTool } from '../tools/registry.js';
import { getMergeBase } from '../git/getMergeBase.js';
import { getChangedFiles } from '../git/getChangedFiles.js';
import { apiGuard } from '../tools/composites/apiGuard.js';
import { findTestFiles } from '../tools/composites/findTestFiles.js';
import { pathToUri, relativePath } from '../engine/positions.js';
import { waitForDiagnostics } from '../engine/waitForDiagnostics.js';
import { programManager } from '../analysis/ts/program/ProgramManager.js';
import { CheckerQueries } from '../analysis/ts/program/CheckerQueries.js';
import { findNonExhaustiveSwitches, predictAddedMemberImpact } from '../analysis/ts/exhaustiveness.js';
import * as fs from 'fs';
import { parseSourceContent } from '../analysis/ts/parseSourceFile.js';
import { extractExports } from '../analysis/ts/extractExports.js';
import { getBaseFileContent } from '../git/getBaseFileContent.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiagnosticSummary {
  filePath: string;
  errorCount: number;
  errors: Array<{ line: number; message: string; code?: string }>;
}

interface ApiSummary {
  semver: string;
  breaking: number;
  risky: number;
  safe: number;
  entries: any[];
}

interface TestGap {
  symbol: string;
  filePath: string;
  hasTests: boolean;
}

interface TypeRisks {
  /** Switches that are no longer exhaustive due to changed enums */
  nonExhaustiveSwitches: Array<{ filePath: string; line: number; missingMembers: string[]; enumName: string }>;
  /** Exports whose type changed in a potentially incompatible way */
  signatureChanges: Array<{ symbol: string; filePath: string; changeKind: string }>;
}

export interface VerifyResult {
  base: string | undefined;
  changedFiles: string[];
  diagnostics: DiagnosticSummary[];
  totalErrors: number;
  api: ApiSummary | null;
  testGaps: TestGap[];
  /** Phase 3A: type-state risks found in changed files */
  typeRisks: TypeRisks;
  /** Phase 3A: shell commands the developer should run next */
  suggestedCommands: string[];
  /** Phase 3A: ordered list of what to check or fix */
  nextSteps: string[];
  /** Phase 3A: clear verdict */
  verdict: 'safe' | 'needs-attention' | 'has-errors';
  /** Phase 3A: one sentence explaining the verdict */
  verdictReason: string;
  warnings: string[];
  elapsedMs: number;
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const verifyChangeSet = defineTool({
  name: 'verify_changes',
  description:
    'Full pre-merge verification: diagnostics on changed files, API contract check, type-state risks (exhaustiveness, compatibility), test coverage gaps. ' +
    'Returns a structured verdict with specific next steps and suggested commands.',
  schema: z.object({
    base: z.string().optional().describe('Git base branch (auto-detected if omitted)'),
    paths: z.array(z.string()).optional().describe('Limit to specific paths'),
  }),
  async handler(params, engine) {
    const startTime = Date.now();
    const warnings: string[] = [];

    // Step 1: Determine changed files
    const base = engine.gitAvailable ? getMergeBase(engine.workspaceRoot, params.base) : undefined;
    if (!base) {
      return earlyReturn(startTime, { verdict: 'needs-attention', verdictReason: 'Git not available — run with base branch or from a git repository', warnings: ['Could not determine git base'] });
    }

    let changedFiles = getChangedFiles(engine.workspaceRoot, base);
    if (params.paths?.length) {
      changedFiles = changedFiles.filter((f) => params.paths!.some((p) => f.includes(p)));
    }

    if (changedFiles.length === 0) {
      return earlyReturn(startTime, { verdict: 'safe', verdictReason: 'No changed files — nothing to verify', warnings: ['No changed files found'] });
    }

    // Step 2: Diagnostics on changed files (using cached diagnostics from LSP push)
    const diagnostics: DiagnosticSummary[] = [];
    let totalErrors = 0;

    for (const filePath of changedFiles) {
      try {
        const uri = pathToUri(filePath);
        await engine.prepareFile(filePath);
        await waitForDiagnostics(engine.docManager, uri, 1500);
        const fileDiags = engine.docManager.getCachedDiagnostics(uri);

        const errors = fileDiags
          .filter((d) => d.severity === 1)
          .map((d) => ({
            line: (d.range?.start?.line ?? 0) + 1,
            message: d.message ?? 'Unknown error',
            code: d.code != null ? `TS${d.code}` : undefined,
          }));

        if (errors.length > 0) {
          diagnostics.push({ filePath: relativePath(filePath, engine.workspaceRoot), errorCount: errors.length, errors });
          totalErrors += errors.length;
        }
      } catch {
        // Skip files that can't be diagnosed
      }
    }

    // Step 3: API contract guard
    let api: ApiSummary | null = null;
    const hasExportFiles = changedFiles.some((f) => /\.(ts|tsx|js|jsx)$/.test(f));

    if (hasExportFiles) {
      try {
        const guardResult = await apiGuard.handler({ scope: 'changed', base: params.base }, engine) as any;
        api = {
          semver: guardResult.summary?.recommendedSemver ?? 'patch',
          breaking: guardResult.summary?.breaking ?? 0,
          risky: guardResult.summary?.risky ?? 0,
          safe: guardResult.summary?.safe ?? 0,
          entries: guardResult.entries ?? [],
        };
      } catch (err: any) {
        warnings.push(`api_guard failed: ${err?.message ?? 'unknown'}`);
      }
    }

    // Step 4: Phase 3A — Type-state risks via Phase 2D (exhaustiveness + compatibility)
    const typeRisks: TypeRisks = { nonExhaustiveSwitches: [], signatureChanges: [] };
    try {
      const tsProgram = programManager.getOrBuild(engine.workspaceRoot);
      const queries = new CheckerQueries(tsProgram);

      for (const filePath of changedFiles) {
        try {
          const baseContent = getBaseFileContent(filePath, base, engine.workspaceRoot);
          if (!baseContent) continue;

          const currentContent = fs.readFileSync(filePath, 'utf-8');
          const baseSf = parseSourceContent(baseContent, filePath);
          const currentSf = parseSourceContent(currentContent, filePath);

          const baseExports = extractExports(baseSf);
          const currentExports = extractExports(currentSf);

          // Find changed enums and check exhaustiveness impact
          const baseEnums = new Map(baseExports.filter(e => e.kind === 'enum').map(e => [e.name, e]));
          const currentEnums = new Map(currentExports.filter(e => e.kind === 'enum').map(e => [e.name, e]));

          for (const [enumName] of currentEnums) {
            if (baseEnums.has(enumName)) {
              // Enum existed before — check if members changed
              const baseMembers = queries.getEnumMembers(filePath, enumName) ?? [];
              // Members in current version (use AST directly)
              const currentSfEnum = currentSf.statements.find((s: any) =>
                s.kind !== undefined &&
                s.name?.text === enumName &&
                s.members !== undefined,
              );
              if (currentSfEnum) {
                // Use addedMemberImpact for each new member to find affected switches
                const nonExhaustive = findNonExhaustiveSwitches(tsProgram, filePath, enumName);
                for (const sw of nonExhaustive) {
                  typeRisks.nonExhaustiveSwitches.push({
                    filePath: relativePath(sw.filePath, engine.workspaceRoot),
                    line: sw.line,
                    missingMembers: sw.missingMembers,
                    enumName,
                  });
                }
              }
            }
          }

          // Collect signature changes from api entries if available
          if (api) {
            for (const entry of api.entries) {
              if (entry.risk !== 'safe' && (entry.kind === 'param_required' || entry.kind === 'return_type_changed' || entry.kind === 'param_removed')) {
                typeRisks.signatureChanges.push({
                  symbol: entry.exportName,
                  filePath: relativePath(entry.filePath, engine.workspaceRoot),
                  changeKind: entry.kind,
                });
              }
            }
          }
        } catch {
          // Best-effort per file
        }
      }
    } catch (err: any) {
      warnings.push(`Type-risk analysis failed: ${err?.message ?? 'unknown'}`);
    }

    // Step 5: Test coverage gaps for high-risk changed symbols
    const testGaps: TestGap[] = [];
    if (api?.entries) {
      const breaking = api.entries.filter((e: any) => e.risk === 'breaking').slice(0, 5);
      for (const entry of breaking) {
        try {
          const testResult = await findTestFiles.handler({ symbol: entry.exportName }, engine) as string;
          const hasTests = !testResult.includes('No test files') && !testResult.includes('No references');
          testGaps.push({ symbol: entry.exportName, filePath: entry.filePath, hasTests });
        } catch {
          testGaps.push({ symbol: entry.exportName, filePath: entry.filePath, hasTests: false });
        }
      }
    }

    // Step 6: Phase 3A — Build verdict, next steps, and suggested commands
    const { verdict, verdictReason, nextSteps, suggestedCommands } = buildVerdict({
      totalErrors,
      api,
      typeRisks,
      testGaps,
      changedFiles: changedFiles.map((f) => relativePath(f, engine.workspaceRoot)),
      workspaceRoot: engine.workspaceRoot,
    });

    return {
      base,
      changedFiles: changedFiles.map((f) => relativePath(f, engine.workspaceRoot)),
      diagnostics,
      totalErrors,
      api,
      testGaps,
      typeRisks,
      suggestedCommands,
      nextSteps,
      verdict,
      verdictReason,
      warnings,
      elapsedMs: Date.now() - startTime,
    } satisfies VerifyResult;
  },
});

// ---------------------------------------------------------------------------
// Verdict builder — Phase 3A
// ---------------------------------------------------------------------------

interface VerdictInput {
  totalErrors: number;
  api: ApiSummary | null;
  typeRisks: TypeRisks;
  testGaps: TestGap[];
  changedFiles: string[];
  workspaceRoot: string;
}

function buildVerdict(input: VerdictInput): {
  verdict: VerifyResult['verdict'];
  verdictReason: string;
  nextSteps: string[];
  suggestedCommands: string[];
} {
  const { totalErrors, api, typeRisks, testGaps, changedFiles } = input;
  const nextSteps: string[] = [];
  const suggestedCommands: string[] = [];

  // Hard errors first
  if (totalErrors > 0) {
    nextSteps.push(`Fix ${totalErrors} TypeScript error(s) in changed files before merging`);
    suggestedCommands.push('npx tsc --noEmit');
    for (const entry of (api?.entries ?? []).filter((e: any) => e.risk === 'breaking').slice(0, 3)) {
      for (const step of (entry.migrationSteps ?? [])) nextSteps.push(step);
    }
    return {
      verdict: 'has-errors',
      verdictReason: `${totalErrors} TypeScript error(s) found in changed files`,
      nextSteps,
      suggestedCommands,
    };
  }

  // Breaking API changes
  const breaking = api?.breaking ?? 0;
  const switchIssues = typeRisks.nonExhaustiveSwitches.length;
  const sigChanges = typeRisks.signatureChanges.length;

  if (breaking > 0 || switchIssues > 0 || sigChanges > 0) {
    if (breaking > 0) {
      nextSteps.push(`${breaking} breaking API change(s) — update consumers before merging`);
      for (const entry of (api?.entries ?? []).filter((e: any) => e.risk === 'breaking').slice(0, 3)) {
        for (const step of (entry.migrationSteps ?? [])) nextSteps.push(step);
        if (entry.filesToInspect?.length) {
          suggestedCommands.push(`# Check consumers of ${entry.exportName}:`);
          suggestedCommands.push(`grep -r '${entry.exportName}' --include='*.ts' src/`);
        }
      }
    }
    if (switchIssues > 0) {
      nextSteps.push(`${switchIssues} non-exhaustive switch statement(s) — add cases for new enum members`);
      const affected = [...new Set(typeRisks.nonExhaustiveSwitches.map(s => s.filePath))].slice(0, 2);
      suggestedCommands.push(`# Fix exhaustiveness in: ${affected.join(', ')}`);
    }
    if (sigChanges > 0) {
      nextSteps.push(`${sigChanges} signature change(s) — verify all callers pass the correct arguments`);
      for (const sc of typeRisks.signatureChanges.slice(0, 3)) {
        suggestedCommands.push(`grep -r '${sc.symbol}(' --include='*.ts' src/`);
      }
    }

    // Test gaps
    const untested = testGaps.filter((g) => !g.hasTests);
    if (untested.length > 0) {
      nextSteps.push(`${untested.length} breaking export(s) lack test coverage`);
    }

    const reasons: string[] = [];
    if (breaking > 0) reasons.push(`${breaking} breaking API change(s)`);
    if (switchIssues > 0) reasons.push(`${switchIssues} exhaustiveness issue(s)`);
    if (sigChanges > 0) reasons.push(`${sigChanges} signature change(s)`);

    return {
      verdict: 'needs-attention',
      verdictReason: reasons.join(', '),
      nextSteps,
      suggestedCommands,
    };
  }

  // Risky-only changes
  const risky = api?.risky ?? 0;
  if (risky > 0) {
    nextSteps.push(`${risky} risky (non-breaking) API change(s) — review before release`);
    if (api?.semver === 'minor') {
      nextSteps.push('Bump the minor version when releasing (new functionality added)');
    }
    return {
      verdict: 'needs-attention',
      verdictReason: `${risky} risky change(s) — recommend review before release`,
      nextSteps,
      suggestedCommands,
    };
  }

  // Safe
  nextSteps.push('All checks passed — safe to merge');
  if (changedFiles.length > 0) {
    const ext = changedFiles[0].endsWith('.ts') ? 'ts' : 'js';
    suggestedCommands.push('npm test');
  }

  return {
    verdict: 'safe',
    verdictReason: 'No errors, no breaking changes, no type risks detected',
    nextSteps,
    suggestedCommands,
  };
}

// ---------------------------------------------------------------------------
// Early return helper
// ---------------------------------------------------------------------------

function earlyReturn(startTime: number, overrides: Partial<VerifyResult>): VerifyResult {
  return {
    base: undefined,
    changedFiles: [],
    diagnostics: [],
    totalErrors: 0,
    api: null,
    testGaps: [],
    typeRisks: { nonExhaustiveSwitches: [], signatureChanges: [] },
    suggestedCommands: [],
    nextSteps: [],
    verdict: 'safe',
    verdictReason: '',
    warnings: [],
    elapsedMs: Date.now() - startTime,
    ...overrides,
  };
}
