import * as crypto from 'crypto';
import * as path from 'path';

/**
 * Phase 4B — Workspace fingerprinting.
 *
 * Computes a stable key for a workspace scope so the persistent cache
 * can be partitioned by workspace + scope without collisions.
 */

export interface ScopeFingerprint {
  /** Stable key for cache file naming */
  key: string;
  /** Human-readable label for debugging */
  label: string;
}

/**
 * Compute a fingerprint for a search scope.
 * Deterministic: same scope always produces the same key.
 */
export function computeScopeFingerprint(
  workspaceRoot: string,
  includeTests: boolean,
): ScopeFingerprint {
  const normalized = path.normalize(workspaceRoot).toLowerCase();
  const content = `${normalized}:tests=${includeTests}`;
  const key = crypto.createHash('sha1').update(content).digest('hex').slice(0, 16);
  const label = path.basename(workspaceRoot);
  return { key, label };
}
