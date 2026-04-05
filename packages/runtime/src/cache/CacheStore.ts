import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { WorkspaceIndex } from '../search/types.js';
import { CACHE_SCHEMA_VERSION, type PersistedIndex } from './CacheSchema.js';

/**
 * Phase 4B — Persistent cache store.
 *
 * Reads and writes the workspace index to disk as JSON.
 * Location: <os.tmpdir()>/lsp-intelligence-cache/<fingerprint>/index-v<version>.json
 *
 * Positioned as ACCELERATION, not source of truth. The live semantic state
 * (workspace snapshot, LSP, TypeScript checker) always wins.
 */

const CACHE_BASE_DIR = path.join(os.tmpdir(), 'lsp-intelligence-cache');
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export class CacheStore {
  private readonly cacheDir: string;
  private readonly cacheFile: string;

  constructor(fingerprint: string, indexVersion: number) {
    this.cacheDir = path.join(CACHE_BASE_DIR, fingerprint);
    this.cacheFile = path.join(this.cacheDir, `index-v${CACHE_SCHEMA_VERSION}-i${indexVersion}.json`);
  }

  /**
   * Load a persisted index from disk.
   * Returns null if no cache exists, the schema is wrong, or the cache is too old.
   */
  load(): PersistedIndex | null {
    try {
      if (!fs.existsSync(this.cacheFile)) return null;

      const stat = fs.statSync(this.cacheFile);
      if (Date.now() - stat.mtimeMs > MAX_CACHE_AGE_MS) {
        this.evict();
        return null;
      }

      const raw = fs.readFileSync(this.cacheFile, 'utf-8');
      const parsed = JSON.parse(raw) as PersistedIndex;

      if (parsed.schemaVersion !== CACHE_SCHEMA_VERSION) return null;

      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Save a workspace index to disk.
   * Serializes the files Map and stores file mtimes for freshness validation.
   * Non-blocking: errors are silently swallowed (cache is best-effort).
   */
  save(index: WorkspaceIndex, scopeKey: string, indexVersion: number): void {
    try {
      fs.mkdirSync(this.cacheDir, { recursive: true });

      const fileMtimes: Record<string, number> = {};
      const fileEntries: Array<[string, typeof index.files extends Map<string, infer V> ? V : never]> = [];

      for (const [filePath, entry] of index.files) {
        fileMtimes[filePath] = entry.mtimeMs;
        fileEntries.push([filePath, entry]);
      }

      const buildStart = Date.now();
      const persisted: PersistedIndex = {
        schemaVersion: CACHE_SCHEMA_VERSION,
        indexVersion,
        root: index.root,
        builtAt: index.builtAt,
        scopeKey,
        fileEntries,
        fileMtimes,
        declarations: index.declarations,
        usages: index.usages,
        docs: index.docs,
        configs: index.configs,
        routes: index.routes,
        scopeCapped: index.scopeCapped,
        capReason: index.capReason,
        buildMs: Date.now() - buildStart,
      };

      fs.writeFileSync(this.cacheFile, JSON.stringify(persisted), 'utf-8');
    } catch {
      // Cache writes are best-effort — never block on failure
    }
  }

  /** Remove the cache file for this workspace. */
  evict(): void {
    try { fs.rmSync(this.cacheFile, { force: true }); } catch {}
  }

  /** Remove all cache files older than MAX_CACHE_AGE_MS (for cleanup). */
  static pruneOldCaches(): void {
    try {
      if (!fs.existsSync(CACHE_BASE_DIR)) return;
      const cutoff = Date.now() - MAX_CACHE_AGE_MS;
      for (const dir of fs.readdirSync(CACHE_BASE_DIR)) {
        const dirPath = path.join(CACHE_BASE_DIR, dir);
        try {
          const stat = fs.statSync(dirPath);
          if (stat.isDirectory() && stat.mtimeMs < cutoff) {
            fs.rmSync(dirPath, { recursive: true, force: true });
          }
        } catch {}
      }
    } catch {}
  }
}
