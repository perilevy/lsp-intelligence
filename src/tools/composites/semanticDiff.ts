import { z } from 'zod';
import { execSync } from 'child_process';
import { defineTool } from '../registry.js';
import { pathToUri, relativePath, uriToPath } from '../../engine/positions.js';
import type { Location, DocumentSymbol } from 'vscode-languageserver-protocol';
import { LspError, LspErrorCode, DEFAULT_TIMEOUTS } from '../../engine/types.js';

interface ChangedHunk {
  file: string;
  startLine: number;
  endLine: number;
}

function parseDiffHunks(diff: string, workspaceRoot: string): ChangedHunk[] {
  const hunks: ChangedHunk[] = [];
  let currentFile = '';

  for (const line of diff.split('\n')) {
    // +++ b/path/to/file.ts
    const fileMatch = line.match(/^\+\+\+ b\/(.+)/);
    if (fileMatch) {
      currentFile = `${workspaceRoot}/${fileMatch[1]}`;
      continue;
    }
    // @@ -old,count +new,count @@
    const hunkMatch = line.match(/^@@ .+ \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch && currentFile.match(/\.tsx?$/)) {
      const start = parseInt(hunkMatch[1]);
      const count = parseInt(hunkMatch[2] ?? '1');
      hunks.push({ file: currentFile, startLine: start, endLine: start + count - 1 });
    }
  }
  return hunks;
}

function findSymbolAtLine(symbols: DocumentSymbol[], line0: number): DocumentSymbol | null {
  for (const sym of symbols) {
    if (line0 >= sym.range.start.line && line0 <= sym.range.end.line) {
      // Check children for more specific match
      if (sym.children) {
        const child = findSymbolAtLine(sym.children, line0);
        if (child) return child;
      }
      return sym;
    }
  }
  return null;
}

const SYMBOL_KINDS: Record<number, string> = {
  5: 'Class', 6: 'Method', 10: 'Enum', 11: 'Interface',
  12: 'Function', 13: 'Variable', 14: 'Constant',
};

export const semanticDiff = defineTool({
  name: 'semantic_diff',
  description: 'Analyze git diff semantically: identify changed symbols and their blast radius. Answers "what did I change and what might break?" Requires git.',
  schema: z.object({
    base: z.string().optional().describe('Base ref to diff against. Defaults to merge-base with main branch.'),
    verbosity: z.enum(['summary', 'normal', 'detailed']).default('normal'),
  }),
  async handler(params, engine) {
    if (!engine.gitAvailable) {
      throw new LspError(LspErrorCode.GIT_UNAVAILABLE, 'Git is not available in this workspace.');
    }

    const timeout = DEFAULT_TIMEOUTS.composite;

    // Determine base ref
    let base = params.base;
    if (!base) {
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

    // Get diff
    let diff: string;
    try {
      diff = execSync(`git diff ${base} --unified=0`, { cwd: engine.workspaceRoot, encoding: 'utf-8' });
    } catch {
      return 'No changes found or invalid base ref.';
    }

    if (!diff.trim()) return 'No changes found.';

    const hunks = parseDiffHunks(diff, engine.workspaceRoot);
    if (hunks.length === 0) return 'No TypeScript file changes found.';

    // For each changed hunk, identify the symbol
    const changedSymbols: { name: string; kind: string; file: string; refCount: number }[] = [];
    const processedFiles = new Set<string>();

    for (const hunk of hunks) {
      if (processedFiles.has(hunk.file)) continue;

      try {
        const { uri } = await engine.prepareFile(hunk.file);
        const symbols = await engine.request<DocumentSymbol[] | null>(
          'textDocument/documentSymbol', { textDocument: { uri } }, timeout,
        );

        if (symbols) {
          // Find symbols affected by this hunk
          for (let line = hunk.startLine - 1; line <= hunk.endLine - 1; line++) {
            const sym = findSymbolAtLine(symbols, line);
            if (sym && !changedSymbols.some((s) => s.name === sym.name && s.file === hunk.file)) {
              // Get reference count for blast radius
              const refs = await engine.request<Location[] | null>(
                'textDocument/references', {
                  textDocument: { uri },
                  position: sym.selectionRange.start,
                  context: { includeDeclaration: false },
                }, timeout,
              ).catch(() => null);

              changedSymbols.push({
                name: sym.name,
                kind: SYMBOL_KINDS[sym.kind] ?? 'Unknown',
                file: relativePath(hunk.file, engine.workspaceRoot),
                refCount: refs?.length ?? 0,
              });
            }
          }
        }
      } catch {}
      processedFiles.add(hunk.file);
    }

    if (changedSymbols.length === 0) return 'No identifiable symbol changes found in diff.';

    const totalRefs = changedSymbols.reduce((s, c) => s + c.refCount, 0);
    const lines = [`# Semantic Diff\n`];
    lines.push(`${changedSymbols.length} symbols changed, ${totalRefs} total references affected\n`);

    for (const sym of changedSymbols.sort((a, b) => b.refCount - a.refCount)) {
      const risk = sym.refCount > 10 ? '🔴' : sym.refCount > 3 ? '🟡' : '🟢';
      lines.push(`${risk} **${sym.name}** (${sym.kind}) — ${sym.file}`);
      if (sym.refCount > 0) {
        lines.push(`  → ${sym.refCount} references may need updating`);
      } else {
        lines.push(`  → No external references (safe to change)`);
      }
    }

    return lines.join('\n');
  },
});
