import type { DocumentManager } from '../engine/DocumentManager.js';
import { uriToPath } from '../engine/positions.js';
import type { WorkspaceSnapshot } from './WorkspaceSnapshot.js';
import { OverlayStore } from './OverlayStore.js';

/**
 * Resolves file text, preferring in-memory overlay over disk.
 *
 * Consumers (indexer, analysis tools) call getText(filePath) to get
 * the most up-to-date content. If the file has an unsaved edit in the
 * editor, the overlay text is returned instead of the disk version.
 */
export interface SnapshotResolver {
  /** Return overlay text if the file has an unsaved edit, otherwise undefined. */
  getText(filePath: string): string | undefined;
  /** True if the file has an in-memory overlay (whether dirty or not). */
  hasOverlay(filePath: string): boolean;
  /** All files that have dirty (unsaved) overlays. */
  getDirtyFiles(): string[];
}

/**
 * Build a SnapshotResolver from a DocumentManager.
 * Called in tool handlers to get live overlay state before indexing.
 */
export function buildSnapshotResolver(docManager: DocumentManager, workspaceRoot: string): SnapshotResolver {
  const store = new OverlayStore(docManager);
  const snapshot = store.createSnapshot(workspaceRoot);
  return fromSnapshot(snapshot);
}

/**
 * Build a SnapshotResolver from a pre-built WorkspaceSnapshot.
 */
export function fromSnapshot(snapshot: WorkspaceSnapshot): SnapshotResolver {
  return {
    getText(filePath: string): string | undefined {
      return snapshot.overlays.get(filePath)?.text;
    },
    hasOverlay(filePath: string): boolean {
      return snapshot.overlays.has(filePath);
    },
    getDirtyFiles(): string[] {
      const dirty: string[] = [];
      for (const [filePath, doc] of snapshot.overlays) {
        if (doc.dirty) dirty.push(filePath);
      }
      return dirty;
    },
  };
}

/**
 * Build a SnapshotResolver directly from a static map of overlays.
 * Used in tests and benchmarks without a live DocumentManager.
 */
export function buildStaticSnapshotResolver(overlays: Record<string, string>): SnapshotResolver {
  const map = new Map(Object.entries(overlays));
  return {
    getText(filePath: string): string | undefined {
      return map.get(filePath);
    },
    hasOverlay(filePath: string): boolean {
      return map.has(filePath);
    },
    getDirtyFiles(): string[] {
      return [...map.keys()];
    },
  };
}
