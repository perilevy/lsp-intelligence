import type {
  IndexedFile,
  DeclarationIndexEntry,
  UsageIndexEntry,
  DocIndexEntry,
  ConfigIndexEntry,
  RouteIndexEntry,
} from '../search/types.js';

/**
 * Phase 4B — Persistent cache schema.
 *
 * This is the on-disk representation of a WorkspaceIndex.
 * The `files` Map is serialized as an array of [key, value] pairs.
 */

/** Bump when index format changes to auto-invalidate stale caches. */
export const CACHE_SCHEMA_VERSION = 1;

export interface PersistedIndex {
  schemaVersion: number;
  /** INDEX_VERSION from workspaceIndex — triggers rebuild on search logic changes */
  indexVersion: number;
  root: string;
  builtAt: number;
  scopeKey: string;
  /** Serialized Map<string, IndexedFile> entries */
  fileEntries: Array<[string, IndexedFile]>;
  /** Per-file mtimes at time of build (for freshness validation) */
  fileMtimes: Record<string, number>;
  declarations: DeclarationIndexEntry[];
  usages: UsageIndexEntry[];
  docs: DocIndexEntry[];
  configs: ConfigIndexEntry[];
  routes: RouteIndexEntry[];
  scopeCapped: boolean;
  capReason?: string;
  /** Cache build metadata */
  buildMs: number;
}
