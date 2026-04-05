import ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { SnapshotResolver } from '../../../session/SnapshotResolver.js';

/**
 * Manages a cached TypeScript Program for semantic queries.
 *
 * This is NOT a replacement for the LSP server — it's a focused semantic
 * accelerator for questions that AST analysis alone cannot answer reliably:
 * enum member enumeration, type compatibility, exhaustiveness, param signatures.
 *
 * Integrates with the Phase 2A SnapshotResolver so the program operates on
 * live (unsaved) buffer content when overlays are present.
 */
export class ProgramManager {
  // Keyed by full cache key (workspaceRoot + tsconfig hash + dirty files signature)
  // so different overlay states produce independent program instances.
  private cache = new Map<string, ts.Program>();

  /**
   * Get or build a TypeScript Program for a workspace root.
   *
   * @param workspaceRoot - Absolute path to the workspace root.
   * @param resolver - Optional Phase 2A snapshot resolver for overlay awareness.
   *   Different resolver states produce separate cached programs — overlay and
   *   disk programs never share a cache entry.
   */
  getOrBuild(workspaceRoot: string, resolver?: SnapshotResolver): ts.Program {
    const cacheKey = buildCacheKey(workspaceRoot, resolver);
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const program = buildProgram(workspaceRoot, resolver);
    this.cache.set(cacheKey, program);
    return program;
  }

  /** Invalidate all cached programs for a workspace root. */
  invalidate(workspaceRoot: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(workspaceRoot + ':')) this.cache.delete(key);
    }
  }
}

// Module-level singleton — one manager per process.
export const programManager = new ProgramManager();

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildCacheKey(workspaceRoot: string, resolver?: SnapshotResolver): string {
  const tsConfigPath = findTsConfig(workspaceRoot);
  const tsConfigHash = tsConfigPath ? hashFile(tsConfigPath) : 'no-tsconfig';
  const dirtyKey = resolver ? resolver.getDirtyFiles().sort().join('|') : '';
  return `${workspaceRoot}:${tsConfigHash}:${dirtyKey}`;
}

function buildProgram(workspaceRoot: string, resolver?: SnapshotResolver): ts.Program {
  const tsConfigPath = findTsConfig(workspaceRoot);
  let compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    strict: false,
    noEmit: true,
    allowJs: true,
    skipLibCheck: true,
    skipDefaultLibCheck: true,
  };
  let rootNames: string[] = [];

  if (tsConfigPath) {
    try {
      const { config, error } = ts.readConfigFile(tsConfigPath, ts.sys.readFile);
      if (!error) {
        const parsed = ts.parseJsonConfigFileContent(
          config,
          ts.sys,
          path.dirname(tsConfigPath),
          {},
          tsConfigPath,
        );
        compilerOptions = { ...parsed.options, noEmit: true, skipLibCheck: true, skipDefaultLibCheck: true };
        rootNames = parsed.fileNames;
      }
    } catch {
      // Fall back to defaults
    }
  }

  // If no files from tsconfig, collect manually
  if (rootNames.length === 0) {
    rootNames = collectTsFiles(workspaceRoot);
  }

  const host = createSnapshotHost(compilerOptions, resolver);
  return ts.createProgram(rootNames, compilerOptions, host);
}

/**
 * Create a CompilerHost that respects the SnapshotResolver for overlay content.
 */
function createSnapshotHost(
  options: ts.CompilerOptions,
  resolver?: SnapshotResolver,
): ts.CompilerHost {
  const defaultHost = ts.createCompilerHost(options);

  return {
    ...defaultHost,

    getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile) {
      // Use overlay text if available (Phase 2A integration)
      const overlayText = resolver?.getText(path.normalize(fileName));
      if (overlayText !== undefined) {
        return ts.createSourceFile(fileName, overlayText, languageVersion, true);
      }
      return defaultHost.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
    },

    fileExists(fileName) {
      // Overlay files exist even if not on disk
      if (resolver?.hasOverlay(path.normalize(fileName))) return true;
      return defaultHost.fileExists(fileName);
    },

    readFile(fileName) {
      const overlayText = resolver?.getText(path.normalize(fileName));
      if (overlayText !== undefined) return overlayText;
      return defaultHost.readFile(fileName);
    },
  };
}

function findTsConfig(workspaceRoot: string): string | undefined {
  return ts.findConfigFile(workspaceRoot, ts.sys.fileExists, 'tsconfig.json') ?? undefined;
}

function collectTsFiles(dir: string, depth = 0): string[] {
  if (depth > 6) return [];
  const files: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const skip = ['node_modules', 'dist', 'build', '.git', 'coverage'];
        if (entry.name.startsWith('.') || skip.includes(entry.name)) continue;
        files.push(...collectTsFiles(path.join(dir, entry.name), depth + 1));
      } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        files.push(path.join(dir, entry.name));
      }
    }
  } catch {}
  return files;
}

function hashFile(filePath: string): string {
  try {
    return crypto.createHash('sha1').update(fs.readFileSync(filePath)).digest('hex').slice(0, 8);
  } catch {
    return 'unreadable';
  }
}
