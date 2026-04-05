import * as fs from 'fs';
import type { WorkspaceIndex, IndexedFile, SearchScope } from '../search/types.js';
import { CacheStore } from './CacheStore.js';
import { computeScopeFingerprint } from './SnapshotFingerprint.js';
import type { PersistedIndex } from './CacheSchema.js';

/**
 * Phase 4B — Semantic cache main interface.
 *
 * Wraps the CacheStore to provide a higher-level API:
 * - tryLoad: attempt to load and VALIDATE a persisted index
 * - save: persist a freshly built index for the next session
 *
 * Validation: compares stored file mtimes against current disk state.
 * If any file has changed since the cache was built, the cache is stale
 * and returns null (caller rebuilds and saves a fresh cache).
 *
 * IMPORTANT: This cache is bypassed entirely when a SnapshotResolver
 * is provided (overlay/unsaved edits can't be persisted).
 */
export class SemanticCache {
  private readonly store: CacheStore;
  private readonly fingerprint: string;

  constructor(scope: SearchScope, indexVersion: number) {
    const fp = computeScopeFingerprint(scope.roots[0] ?? '', scope.includeTests);
    this.fingerprint = fp.key;
    this.store = new CacheStore(fp.key, indexVersion);
  }

  /**
   * Try to load a valid cached WorkspaceIndex.
   * Returns null if:
   * - No cache file exists
   * - Cache schema version mismatch
   * - Cache is older than 7 days
   * - Any cached file's mtime differs from the current disk mtime
   *
   * Cache validation is O(N files) but uses only stat calls — fast for typical workspaces.
   */
  tryLoad(scopeKey: string): WorkspaceIndex | null {
    const persisted = this.store.load();
    if (!persisted) return null;
    if (persisted.scopeKey !== scopeKey) return null;

    // Validate freshness: check every cached file's mtime
    for (const [filePath, cachedMtime] of Object.entries(persisted.fileMtimes)) {
      try {
        const currentMtime = fs.statSync(filePath).mtimeMs;
        if (currentMtime !== cachedMtime) return null; // file changed
      } catch {
        return null; // file deleted or inaccessible
      }
    }

    // Cache is valid — reconstruct WorkspaceIndex
    return deserializeIndex(persisted);
  }

  /**
   * Persist a freshly built WorkspaceIndex for future sessions.
   * Called after a successful build. Never throws.
   */
  save(index: WorkspaceIndex, scopeKey: string, indexVersion: number): void {
    this.store.save(index, scopeKey, indexVersion);
  }

  /** Invalidate the cache for this workspace (e.g. after clearWorkspaceIndex). */
  invalidate(): void {
    this.store.evict();
  }
}

// ---------------------------------------------------------------------------
// Deserialization
// ---------------------------------------------------------------------------

function deserializeIndex(p: PersistedIndex): WorkspaceIndex {
  // Reconstruct the files Map from the serialized array
  const files = new Map<string, IndexedFile>(
    p.fileEntries.map(([k, v]) => [k, v]),
  );

  return {
    root: p.root,
    builtAt: p.builtAt,
    files,
    declarations: p.declarations,
    usages: p.usages,
    docs: p.docs,
    configs: p.configs,
    routes: p.routes,
    scopeCapped: p.scopeCapped,
    capReason: p.capReason as 'max-files' | 'max-depth' | undefined,
  };
}
