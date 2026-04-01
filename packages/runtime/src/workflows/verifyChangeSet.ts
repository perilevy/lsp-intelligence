import { z } from 'zod';
import { defineTool } from '../tools/registry.js';
import { getMergeBase } from '../git/getMergeBase.js';
import { getChangedFiles } from '../git/getChangedFiles.js';
import { semanticDiff } from '../tools/composites/semanticDiff.js';
import { apiGuard } from '../tools/composites/apiGuard.js';
import { findTestFiles } from '../tools/composites/findTestFiles.js';
import type { LspEngine } from '../engine/LspEngine.js';
import type { Hover, Diagnostic } from 'vscode-languageserver-protocol';
import { relativePath } from '../engine/positions.js';

// --- Types ---

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
  refCount: number;
  hasTests: boolean;
}

export interface VerifyResult {
  base: string | undefined;
  changedFiles: string[];
  diagnostics: DiagnosticSummary[];
  totalErrors: number;
  api: ApiSummary | null;
  testGaps: TestGap[];
  verdict: 'safe to merge' | 'needs attention' | 'has errors';
  warnings: string[];
  elapsedMs: number;
}

// --- Tool ---

export const verifyChangeSet = defineTool({
  name: 'verify_changes',
  description:
    'Full pre-merge verification: diagnostics on changed files, API contract check, test coverage gaps. Returns structured verdict.',
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
      return {
        base: undefined,
        changedFiles: [],
        diagnostics: [],
        totalErrors: 0,
        api: null,
        testGaps: [],
        verdict: 'needs attention' as const,
        warnings: ['Could not determine git base — run with --base or ensure git is available'],
        elapsedMs: Date.now() - startTime,
      } satisfies VerifyResult;
    }

    let changedFiles = getChangedFiles(engine.workspaceRoot, base);
    if (params.paths) {
      changedFiles = changedFiles.filter((f) =>
        params.paths!.some((p) => f.includes(p)));
    }

    if (changedFiles.length === 0) {
      return {
        base,
        changedFiles: [],
        diagnostics: [],
        totalErrors: 0,
        api: null,
        testGaps: [],
        verdict: 'safe to merge' as const,
        warnings: ['No changed files found'],
        elapsedMs: Date.now() - startTime,
      } satisfies VerifyResult;
    }

    // Step 2: Diagnostics on changed files
    const diagnostics: DiagnosticSummary[] = [];
    let totalErrors = 0;

    for (const filePath of changedFiles) {
      try {
        const { uri } = await engine.prepareFile(filePath);
        const diags = await engine.request<Diagnostic[]>(
          'textDocument/publishDiagnostics',
          { uri },
          10_000,
        ).catch(() => null);

        // Fallback: use diagnostics pull if push not available
        const fileDiags = diags ?? await engine.request<any>(
          'textDocument/diagnostic',
          { textDocument: { uri } },
          10_000,
        ).then((r: any) => r?.items ?? []).catch(() => []);

        const errors = (Array.isArray(fileDiags) ? fileDiags : [])
          .filter((d: any) => d.severity === 1) // Error severity
          .map((d: any) => ({
            line: (d.range?.start?.line ?? 0) + 1,
            message: d.message ?? 'Unknown error',
            code: d.code != null ? String(d.code) : undefined,
          }));

        if (errors.length > 0) {
          const relPath = relativePath(filePath, engine.workspaceRoot);
          diagnostics.push({ filePath: relPath, errorCount: errors.length, errors });
          totalErrors += errors.length;
        }
      } catch {
        // Skip files that can't be diagnosed
      }
    }

    // Step 3: API guard
    let api: ApiSummary | null = null;
    const hasExportFiles = changedFiles.some((f) =>
      f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.js') || f.endsWith('.jsx'));

    if (hasExportFiles) {
      try {
        const guardResult = await apiGuard.handler(
          { scope: 'changed', base: params.base },
          engine,
        ) as any;

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

    // Step 4: Test coverage gaps for high-risk symbols
    const testGaps: TestGap[] = [];
    try {
      const diffResult = await semanticDiff.handler(
        { base: params.base, verbosity: 'summary' },
        engine,
      ) as any;

      if (diffResult?.entries) {
        const highRisk = diffResult.entries.filter((e: any) => e.risk === 'high');

        for (const entry of highRisk.slice(0, 10)) {
          try {
            const testResult = await findTestFiles.handler(
              { symbol: entry.symbol },
              engine,
            ) as string;

            const hasTests = !testResult.includes('No test files') && !testResult.includes('No references');
            testGaps.push({
              symbol: entry.symbol,
              filePath: relativePath(entry.file ?? '', engine.workspaceRoot),
              refCount: entry.refCount ?? 0,
              hasTests,
            });
          } catch {
            testGaps.push({
              symbol: entry.symbol,
              filePath: relativePath(entry.file ?? '', engine.workspaceRoot),
              refCount: entry.refCount ?? 0,
              hasTests: false,
            });
          }
        }
      }
    } catch (err: any) {
      warnings.push(`semantic_diff failed: ${err?.message ?? 'unknown'}`);
    }

    // Step 5: Verdict
    let verdict: VerifyResult['verdict'];
    if (totalErrors > 0) {
      verdict = 'has errors';
    } else if (api && api.breaking > 0) {
      verdict = 'needs attention';
    } else if (testGaps.some((g) => !g.hasTests && g.refCount > 10)) {
      verdict = 'needs attention';
    } else {
      verdict = 'safe to merge';
    }

    return {
      base,
      changedFiles: changedFiles.map((f) => relativePath(f, engine.workspaceRoot)),
      diagnostics,
      totalErrors,
      api,
      testGaps,
      verdict,
      warnings,
      elapsedMs: Date.now() - startTime,
    } satisfies VerifyResult;
  },
});
