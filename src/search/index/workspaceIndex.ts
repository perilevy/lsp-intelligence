import * as fs from 'fs';
import type { SearchScope, WorkspaceIndex, IndexedFile, DeclarationIndexEntry, UsageIndexEntry } from '../types.js';
import { collectScopeFiles } from '../../resolve/searchScope.js';
import { indexFileDeclarations } from './declarationIndex.js';
import { indexFileUsages } from './usageIndex.js';

// Per-workspace cache with per-file mtime invalidation
let cachedIndex: WorkspaceIndex | null = null;

/**
 * Get or build a workspace index for the given scope.
 * Uses per-file mtime to invalidate stale entries — no TTL.
 */
export function getWorkspaceIndex(
  scope: SearchScope,
  opts?: { forceRefresh?: boolean },
): WorkspaceIndex {
  const root = scope.roots[0] ?? '';

  // Full refresh if root changed or forced
  if (!cachedIndex || cachedIndex.root !== root || opts?.forceRefresh) {
    cachedIndex = buildFreshIndex(scope);
    return cachedIndex;
  }

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
        cachedIndex.files.set(filePath, { filePath, mtimeMs: mtime, declarations, usages });
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
    rebuildFlatArrays(cachedIndex);
  }

  return cachedIndex;
}

function buildFreshIndex(scope: SearchScope): WorkspaceIndex {
  const root = scope.roots[0] ?? '';
  const files = new Map<string, IndexedFile>();
  const scopeFiles = collectScopeFiles(scope);

  for (const filePath of scopeFiles) {
    try {
      const mtime = fs.statSync(filePath).mtimeMs;
      const declarations = indexFileDeclarations(filePath);
      const usages = indexFileUsages(filePath);
      files.set(filePath, { filePath, mtimeMs: mtime, declarations, usages });
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
  };

  rebuildFlatArrays(index);
  return index;
}

function rebuildFlatArrays(index: WorkspaceIndex): void {
  const declarations: DeclarationIndexEntry[] = [];
  const usages: UsageIndexEntry[] = [];

  for (const file of index.files.values()) {
    declarations.push(...file.declarations);
    usages.push(...file.usages);
  }

  index.declarations = declarations;
  index.usages = usages;
  index.builtAt = Date.now();
}
