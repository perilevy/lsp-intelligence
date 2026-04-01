import * as fs from 'fs';
import type { SearchScope, WorkspaceIndex, IndexedFile, DeclarationIndexEntry, UsageIndexEntry, DocIndexEntry, ConfigIndexEntry } from '../types.js';
import { collectScopeFiles, collectScopeFilesWithMeta, type ScopeCollectionResult } from '../../resolve/searchScope.js';
import { indexFileDeclarations } from './declarationIndex.js';
import { indexFileUsages } from './usageIndex.js';
import { indexFileDocs } from './docIndex.js';
import { indexConfigFiles } from './configIndex.js';
import { indexRoutes } from './routeIndex.js';
import { parseSourceFile } from '../../analysis/ts/parseSourceFile.js';

// Bump this when discovery/exclusion rules change to invalidate stale caches.
const INDEX_VERSION = 2;

// Per-scope cache with per-file mtime invalidation
interface CachedEntry {
  index: WorkspaceIndex;
  version: number;
  scopeKey: string;
}
let cachedEntry: CachedEntry | null = null;

function scopeCacheKey(scope: SearchScope): string {
  return JSON.stringify({
    roots: [...scope.roots].sort(),
    includeTests: scope.includeTests,
  });
}

/** Force-clear the in-memory workspace index. Next query will rebuild from scratch. */
export function clearWorkspaceIndex(): { cleared: boolean; hadEntries: number } {
  const hadEntries = cachedEntry?.index.files.size ?? 0;
  cachedEntry = null;
  return { cleared: true, hadEntries };
}

/**
 * Get or build a workspace index for the given scope.
 * Uses per-file mtime to invalidate stale entries — no TTL.
 * Cache keys by normalized scope (sorted roots + includeTests) + INDEX_VERSION.
 */
export function getWorkspaceIndex(
  scope: SearchScope,
  opts?: { forceRefresh?: boolean },
): WorkspaceIndex {
  const key = scopeCacheKey(scope);

  // Full refresh if scope changed, forced, or index version changed
  if (!cachedEntry || cachedEntry.scopeKey !== key || cachedEntry.version !== INDEX_VERSION || opts?.forceRefresh) {
    const index = buildFreshIndex(scope);
    cachedEntry = { index, version: INDEX_VERSION, scopeKey: key };
    return index;
  }

  const cachedIndex = cachedEntry.index;

  // Incremental: check mtime per file, re-index changed files
  const scopeFiles = collectScopeFiles(scope);
  let changed = false;

  for (const filePath of scopeFiles) {
    try {
      const mtime = fs.statSync(filePath).mtimeMs;
      const existing = cachedIndex.files.get(filePath);

      if (!existing || existing.mtimeMs !== mtime) {
        // File is new or changed — re-index
        const declarations = indexFileDeclarations(filePath);
        const usages = indexFileUsages(filePath);
        const docs = indexFileDocsForFile(filePath);
        cachedIndex.files.set(filePath, { filePath, mtimeMs: mtime, declarations, usages, docs });
        changed = true;
      }
    } catch {
      // File may have been deleted
      if (cachedIndex.files.has(filePath)) {
        cachedIndex.files.delete(filePath);
        changed = true;
      }
    }
  }

  // Remove files no longer in scope
  const scopeSet = new Set(scopeFiles);
  for (const key of cachedIndex.files.keys()) {
    if (!scopeSet.has(key)) {
      cachedIndex.files.delete(key);
      changed = true;
    }
  }

  // Rebuild flat arrays if anything changed
  if (changed) {
    rebuildFlatArrays(cachedIndex, scope);
  }

  return cachedIndex;
}

function buildFreshIndex(scope: SearchScope): WorkspaceIndex {
  const root = scope.roots[0] ?? '';
  const files = new Map<string, IndexedFile>();
  const scopeMeta = collectScopeFilesWithMeta(scope);
  const scopeFiles = scopeMeta.files;

  for (const filePath of scopeFiles) {
    try {
      const mtime = fs.statSync(filePath).mtimeMs;
      const declarations = indexFileDeclarations(filePath);
      const usages = indexFileUsages(filePath);
      const docs = indexFileDocsForFile(filePath);
      files.set(filePath, { filePath, mtimeMs: mtime, declarations, usages, docs });
    } catch {
      // Skip files that can't be read/parsed
    }
  }

  const index: WorkspaceIndex = {
    root,
    builtAt: Date.now(),
    files,
    declarations: [],
    usages: [],
    docs: [],
    configs: [],
    routes: [],
    scopeCapped: scopeMeta.capped,
    capReason: scopeMeta.capReason,
  };

  rebuildFlatArrays(index, scope);
  return index;
}

function rebuildFlatArrays(index: WorkspaceIndex, scope: SearchScope): void {
  const declarations: DeclarationIndexEntry[] = [];
  const usages: UsageIndexEntry[] = [];
  const docs: DocIndexEntry[] = [];

  for (const file of index.files.values()) {
    declarations.push(...file.declarations);
    usages.push(...file.usages);
    docs.push(...file.docs);
  }

  index.declarations = declarations;
  index.usages = usages;
  index.docs = docs;
  index.configs = indexConfigFiles(scope);
  index.routes = indexRoutes(scope);
  index.builtAt = Date.now();
}

function indexFileDocsForFile(filePath: string): DocIndexEntry[] {
  const sf = parseSourceFile(filePath);
  if (!sf) return [];
  return indexFileDocs(sf);
}
