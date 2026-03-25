import type { DocumentManager } from './DocumentManager.js';

/**
 * Wait for diagnostics to be pushed for a URI.
 * Polls every 100ms, returns as soon as diagnostics arrive or timeout hit.
 * Much faster than a fixed sleep when diagnostics arrive quickly.
 */
export async function waitForDiagnostics(
  docManager: DocumentManager,
  uri: string,
  timeoutMs: number = 1000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const diags = docManager.getCachedDiagnostics(uri);
    if (diags.length > 0) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  // Timeout — diagnostics may still arrive later, but we don't block further
}
