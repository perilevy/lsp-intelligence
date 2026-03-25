import { z } from 'zod';
import { execSync } from 'child_process';
import * as fs from 'fs';
import { defineTool } from '../registry.js';
import { relativePath, uriToPath, pathToUri, getPackageName } from '../../engine/positions.js';
import { parseSource } from '../../ast/parseFile.js';
import { extractExportDeclarations } from '../../ast/extractExportDeclarations.js';
import { diffExportDeclarations, type DeclDiff, type ApiRiskLevel } from '../../ast/diffDeclarationShapes.js';
import type { Location } from 'vscode-languageserver-protocol';
import { LspError, LspErrorCode, DEFAULT_TIMEOUTS } from '../../engine/types.js';

export const apiGuard = defineTool({
  name: 'api_guard',
  description: 'Detect public API contract changes: what exports changed, how they changed structurally, who consumes them, and the semver impact. Use before merging to catch accidental breaking changes.',
  schema: z.object({
    base: z.string().optional().describe('Git base ref. Defaults to merge-base with main.'),
    scope: z.enum(['changed', 'all']).default('changed').describe('"changed" = only diff-modified files, "all" = scan all source files'),
  }),
  async handler(params, engine) {
    if (!engine.gitAvailable && params.scope === 'changed') {
      throw new LspError(LspErrorCode.GIT_UNAVAILABLE, 'Git required for scope "changed". Use scope "all" instead.');
    }

    const timeout = DEFAULT_TIMEOUTS.composite;
    let astUsed = false;

    // Step 0: Determine base ref
    let base = params.base;
    if (!base && engine.gitAvailable) {
      try {
        base = execSync('git merge-base HEAD main', { cwd: engine.workspaceRoot, encoding: 'utf-8' }).trim();
      } catch {
        try {
          base = execSync('git merge-base HEAD master', { cwd: engine.workspaceRoot, encoding: 'utf-8' }).trim();
        } catch {
          base = 'HEAD~1';
        }
      }
    }

    // Step 1: Get files in scope
    let scopeFiles: string[];
    if (params.scope === 'changed' && base) {
      const diff = execSync(`git diff ${base} --name-only`, { cwd: engine.workspaceRoot, encoding: 'utf-8' });
      scopeFiles = diff.trim().split('\n')
        .filter((f) => f.match(/\.tsx?$/) && !f.endsWith('.d.ts'))
        .map((f) => `${engine.workspaceRoot}/${f}`)
        .filter((f) => fs.existsSync(f));
    } else {
      // Scan all source files (limited to packages)
      scopeFiles = [];
      const { execSync: exec } = require('child_process');
      try {
        const files = exec('find packages -name "*.ts" -o -name "*.tsx" | grep -v node_modules | grep -v dist | grep -v ".d.ts" | head -500', {
          cwd: engine.workspaceRoot, encoding: 'utf-8',
        });
        scopeFiles = files.trim().split('\n').filter(Boolean).map((f: string) => `${engine.workspaceRoot}/${f}`);
      } catch {}
    }

    if (scopeFiles.length === 0) return 'No files in scope. Nothing to check.';

    // Step 2+3: Parse current + base exports, diff
    const allDiffs: Array<DeclDiff & { filePath: string; consumers?: { samePackage: number; crossPackage: number; sampleFiles: string[] } }> = [];
    let filesParsed = 0;

    for (const filePath of scopeFiles) {
      const currentContent = fs.readFileSync(filePath, 'utf-8');
      const currentRoot = parseSource(currentContent, filePath.endsWith('.tsx'));

      let currentExports = currentRoot
        ? (astUsed = true, extractExportDeclarations(currentRoot, currentContent))
        : extractExportsFallback(currentContent);

      // Get base version of the file
      let baseExports: ReturnType<typeof extractExportDeclarations> = [];
      if (base) {
        const relPath = relativePath(filePath, engine.workspaceRoot);
        try {
          const baseContent = execSync(`git show ${base}:${relPath}`, { cwd: engine.workspaceRoot, encoding: 'utf-8' });
          const baseRoot = parseSource(baseContent, filePath.endsWith('.tsx'));
          baseExports = baseRoot
            ? extractExportDeclarations(baseRoot, baseContent)
            : extractExportsFallback(baseContent);
        } catch {
          // File didn't exist in base — all exports are new
        }
      }

      const diffs = diffExportDeclarations(baseExports, currentExports);
      for (const d of diffs) {
        allDiffs.push({ ...d, filePath });
      }
      filesParsed++;
    }

    if (allDiffs.length === 0) return 'No export changes detected. API surface is unchanged.';

    // Step 4: Find consumers for changed/risky/breaking exports
    for (const diff of allDiffs.filter((d) => d.risk !== 'safe')) {
      try {
        const { uri } = await engine.prepareFile(diff.filePath);
        // Find the export's position by searching for it in the file
        const content = fs.readFileSync(diff.filePath, 'utf-8');
        const lines = content.split('\n');
        let exportLine = -1;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(diff.name) && lines[i].includes('export')) {
            exportLine = i;
            break;
          }
        }

        if (exportLine >= 0) {
          const refs = await engine.request<Location[] | null>(
            'textDocument/references', {
              textDocument: { uri },
              position: { line: exportLine, character: lines[exportLine].indexOf(diff.name) },
              context: { includeDeclaration: false },
            }, timeout,
          ).catch(() => null);

          if (refs) {
            const currentPkg = getPackageName(diff.filePath);
            const samePackage = refs.filter((r) => getPackageName(uriToPath(r.uri)) === currentPkg).length;
            const crossPackage = refs.length - samePackage;
            const sampleFiles = [...new Set(refs.map((r) => relativePath(uriToPath(r.uri), engine.workspaceRoot)))].slice(0, 5);
            diff.consumers = { samePackage, crossPackage, sampleFiles };

            // Upgrade risk if cross-package consumers exist
            if (crossPackage > 0 && diff.risk === 'risky') {
              // Keep risky — cross-package consumers confirm it matters
            }
            if (crossPackage === 0 && diff.risk === 'risky') {
              diff.risk = 'safe'; // No cross-package consumers → less risky
              diff.reason += ' (no cross-package consumers)';
            }
          }
        }
      } catch {}
    }

    // Step 5+6: Classify and summarize
    const breaking = allDiffs.filter((d) => d.risk === 'breaking');
    const risky = allDiffs.filter((d) => d.risk === 'risky');
    const safe = allDiffs.filter((d) => d.risk === 'safe');
    const semver = breaking.length > 0 ? 'major' : risky.length > 0 ? 'minor' : 'patch';

    // Step 7: Format output
    const lines: string[] = [`# API Guard Report\n`];
    lines.push(`**Semver: ${semver.toUpperCase()}** | ${allDiffs.length} export changes (${breaking.length} breaking, ${risky.length} risky, ${safe.length} safe)`);
    lines.push(`AST used: ${astUsed} | Files parsed: ${filesParsed}\n`);

    if (breaking.length > 0) {
      lines.push(`## Breaking Changes (${breaking.length})\n`);
      for (const d of breaking) {
        formatEntry(d, engine.workspaceRoot, lines);
      }
    }

    if (risky.length > 0) {
      lines.push(`## Risky Changes (${risky.length})\n`);
      for (const d of risky) {
        formatEntry(d, engine.workspaceRoot, lines);
      }
    }

    if (safe.length > 0) {
      lines.push(`## Safe Changes (${safe.length})\n`);
      for (const d of safe) {
        const rel = relativePath(d.filePath, engine.workspaceRoot);
        lines.push(`🟢 **${d.name}** (${d.kind}) — ${rel}`);
        lines.push(`   ${d.reason}\n`);
      }
    }

    return lines.join('\n');
  },
});

function formatEntry(
  d: DeclDiff & { filePath: string; consumers?: { samePackage: number; crossPackage: number; sampleFiles: string[] } },
  workspaceRoot: string,
  lines: string[],
): void {
  const rel = relativePath(d.filePath, workspaceRoot);
  const icon = d.risk === 'breaking' ? '🔴' : '🟡';
  lines.push(`${icon} **${d.name}** (${d.kind}) — ${rel}`);
  lines.push(`   ${d.reason}`);

  if (d.structuralDiff.length > 0) {
    for (const sd of d.structuralDiff.slice(0, 5)) {
      lines.push(`   \`${sd}\``);
    }
  }

  if (d.consumers) {
    lines.push(`   Consumers: ${d.consumers.crossPackage} cross-package, ${d.consumers.samePackage} same-package`);
    if (d.consumers.sampleFiles.length > 0) {
      lines.push(`   Sample: ${d.consumers.sampleFiles.slice(0, 3).join(', ')}`);
    }
  }
  lines.push('');
}

/**
 * Fallback export extraction without AST — regex only.
 */
function extractExportsFallback(content: string) {
  return extractExportDeclarations(null as any, content);
}
