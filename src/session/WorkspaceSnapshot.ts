/**
 * A single open document captured in a workspace snapshot.
 */
export interface OverlayDocument {
  filePath: string;
  uri: string;
  version: number;
  text: string;
  languageId: string;
  /** True if the in-memory text differs from the on-disk version */
  dirty: boolean;
}

/**
 * Immutable view of all open documents at a point in time.
 * Used by SnapshotResolver to provide overlay text to tools.
 */
export interface WorkspaceSnapshot {
  root: string;
  createdAt: number;
  overlays: Map<string, OverlayDocument>;
}
