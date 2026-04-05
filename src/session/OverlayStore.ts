import * as fs from 'fs';
import { uriToPath } from '../engine/positions.js';
import type { DocumentManager } from '../engine/DocumentManager.js';
import type { WorkspaceSnapshot, OverlayDocument } from './WorkspaceSnapshot.js';

/**
 * Builds a WorkspaceSnapshot from the current DocumentManager state.
 * A snapshot is an immutable view of all open documents at a point in time.
 *
 * Documents whose in-memory content differs from disk are marked dirty=true.
 * The snapshot is used by the SnapshotResolver to provide overlay text to
 * the indexer and analysis tools, so they operate on live (unsaved) state.
 */
export class OverlayStore {
  constructor(private readonly docManager: DocumentManager) {}

  createSnapshot(workspaceRoot: string): WorkspaceSnapshot {
    const overlays = new Map<string, OverlayDocument>();

    for (const [uri, doc] of this.docManager.getOpenDocuments()) {
      const filePath = uriToPath(uri);

      // Mark dirty if in-memory content differs from disk
      let dirty = false;
      try {
        const diskContent = fs.readFileSync(filePath, 'utf-8');
        dirty = diskContent !== doc.content;
      } catch {
        // File may not exist on disk (new/unsaved file) — always dirty
        dirty = true;
      }

      overlays.set(filePath, {
        filePath,
        uri,
        version: doc.version,
        text: doc.content,
        languageId: doc.languageId,
        dirty,
      });
    }

    return {
      root: workspaceRoot,
      createdAt: Date.now(),
      overlays,
    };
  }
}
