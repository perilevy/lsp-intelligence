import * as fs from 'fs';
import type { SearchScope, WorkspaceIndex, IndexedFile, DeclarationIndexEntry, UsageIndexEntry, DocIndexEntry, ConfigIndexEntry } from '../types.js';
import { collectScopeFiles, collectScopeFilesWithMeta, type ScopeCollectionResult } from '../../resolve/searchScope.js';
import { indexFileDeclarations } from './declarationIndex.js';
import { indexFileUsages } from './usageIndex.js';
import { indexFileDocs } from './docIndex.js';
import { indexConfigFiles } from './configIndex.js';
import { indexRoutes } from './routeIndex.js';
import { parseSourceFile } from '../../analysis/ts/parseSourceFile.js';
import type { SnapshotResolver } from '../../session/SnapshotResolver.js';
import { SemanticCache } from '../../cache/SemanticCache.js';

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
export function clearWorkspaceIndex(scope?: SearchScope): { cleared: boolean; hadEntries: number } {
  const hadEntries = cachedEntry?.index.files.size ?? 0;
  cachedEntry = null;
  // Also invalidate the persistent cache for this scope if provided
  if (scope) {
    try { new SemanticCache(scope, INDEX_VERSION).invalidate(); } catch {}
  }
  return { cleared: true, hadEntries };
}

/**
 * Get or build a workspace index for the given scope.
 * Uses per-file mtime to invalidate stale entries — no TTL.
 * Cache keys by normalized scope (sorted roots + includeTests) + INDEX_VERSION.
 *
 * @param opts.snapshot - Optional SnapshotResolver for Phase 2A overlay support.
 *   Dirty (unsaved) files in the snapshot bypass the mtime cache and are
 *   re-indexed from the overlay text rather than from disk.
 */
export function getWorkspaceIndex(
  scope: SearchScope,
  opts?: { forceRefresh?: boolean; snapshot?: SnapshotResolver },
): WorkspaceIndex {
  const key = scopeCacheKey(scope);
  const snapshot = opts?.snapshot;

  // Full refresh if scope changed, forced, or index version changed
  if (!cachedEntry || cachedEntry.scopeKey !== key || cachedEntry.version !== INDEX_VERSION || opts?.forceRefresh) {
    // Phase 4B: try persistent cache ONLY when no overlay is active
    // (overlays represent unsaved state — never persist that)
    if (!snapshot && !opts?.forceRefresh) {
      const diskCache = new SemanticCache(scope, INDEX_VERSION);
      const loaded = diskCache.tryLoad(key);
      if (loaded) {
        cachedEntry = { index: loaded, version: INDEX_VERSION, scopeKey: key };
        return loaded;
      }
    }

    const index = buildFreshIndex(scope, snapshot);
    cachedEntry = { index, version: INDEX_VERSION, scopeKey: key };

    // Persist to disk for the next session (best-effort, bypass if overlay active)
    if (!snapshot) {
      const diskCache = new SemanticCache(scope, INDEX_VERSION);
      diskCache.save(index, key, INDEX_VERSION);
    }

    return index;
  }

  const cachedIndex = cachedEntry.index;

  // Incremental: check mtime per file, re-index changed files
  const scopeFiles = collectScopeFiles(scope);
  let changed = false;

  // If a snapshot is provided, dirty files always get re-indexed from overlay text
  const dirtyFiles = new Set(snapshot?.getDirtyFiles() ?? []);

  for (const filePath of scopeFiles) {
    try {
      const overlayText = snapshot?.getText(filePath);
      const isDirty = dirtyFiles.has(filePath);
      const mtime = isDirty
        ? -1 // force re-index: sentinel mtime that never matches cached
        : fs.statSync(filePath).mtimeMs;
      const existing = cachedIndex.files.get(filePath);

      if (!existing || existing.mtimeMs !== mtime) {
        const declarations = indexFileDeclarations(filePath, overlayText);
        const usages = indexFileUsages(filePath, overlayText);
        const docs = indexFileDocsForFile(filePath, overlayText);
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

function buildFreshIndex(scope: SearchScope, snapshot?: SnapshotResolver): WorkspaceIndex {
  const root = scope.roots[0] ?? '';
  const files = new Map<string, IndexedFile>();
  const scopeMeta = collectScopeFilesWithMeta(scope);
  const scopeFiles = scopeMeta.files;
  const dirtyFiles = new Set(snapshot?.getDirtyFiles() ?? []);

  for (const filePath of scopeFiles) {
    try {
      const overlayText = snapshot?.getText(filePath);
      const isDirty = dirtyFiles.has(filePath);
      // Dirty files use sentinel mtime=-1 so they're always re-indexed when snapshot changes
      const mtime = isDirty ? -1 : fs.statSync(filePath).mtimeMs;
      const declarations = indexFileDeclarations(filePath, overlayText);
      const usages = indexFileUsages(filePath, overlayText);
      const docs = indexFileDocsForFile(filePath, overlayText);
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

function indexFileDocsForFile(filePath: string, text?: string): DocIndexEntry[] {
  const sf = parseSourceFile(filePath, text);
  if (!sf) return [];
  return indexFileDocs(sf);
}
