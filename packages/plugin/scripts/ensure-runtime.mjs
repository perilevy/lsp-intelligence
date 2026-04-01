#!/usr/bin/env node
/**
 * Ensure the lsp-intelligence runtime is installed and ready.
 * Installs into plugin-local .runtime/ directory.
 *
 * This may take time (npm install). Must NOT run inside MCP startup.
 * Called by install-runtime.mjs or plugin bootstrap hooks.
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(__dirname, '..');
const runtimeDir = join(pluginRoot, '.runtime');
const manifestPath = join(runtimeDir, 'manifest.json');
const lockPath = join(runtimeDir, 'install.lock');

// Read runtime config
const runtimeConfig = JSON.parse(readFileSync(join(pluginRoot, 'runtime.json'), 'utf-8')).runtime;
const { package: pkgName, version: expectedVersion } = runtimeConfig;

export async function ensureRuntime({ silent = false } = {}) {
  const log = silent ? () => {} : (msg) => console.error(`[lsp-intelligence] ${msg}`);

  // Check if already ready
  if (isReady()) {
    log(`Runtime ${expectedVersion} is ready.`);
    return { status: 'ready', alreadyInstalled: true };
  }

  // Check install lock
  if (existsSync(lockPath)) {
    try {
      const lockAge = Date.now() - statSync(lockPath).mtimeMs;
      if (lockAge < 5 * 60 * 1000) { // 5 minutes
        log('Another install is in progress. Waiting...');
        return { status: 'installing', alreadyInstalled: false };
      }
      // Stale lock — remove
      unlinkSync(lockPath);
    } catch {}
  }

  // Install
  log(`Installing runtime ${pkgName}@${expectedVersion}...`);
  mkdirSync(runtimeDir, { recursive: true });

  // Write lock
  writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));

  // Write manifest as installing
  writeManifest('installing');

  try {
    execSync(
      `npm install --prefix "${runtimeDir}" --omit=dev --no-fund --no-audit "${pkgName}@${expectedVersion}"`,
      {
        stdio: silent ? 'ignore' : 'inherit',
        timeout: 5 * 60 * 1000, // 5 minute timeout
        env: { ...process.env, npm_config_loglevel: 'error' },
      },
    );
  } catch (err) {
    log(`Install failed: ${err.message}`);
    writeManifest('broken');
    removeLock();
    return { status: 'broken', alreadyInstalled: false, error: err.message };
  }

  // Verify
  const binPath = join(runtimeDir, 'node_modules', '.bin', 'lsp-intelligence');
  if (!existsSync(binPath)) {
    log('Install completed but binary not found.');
    writeManifest('broken');
    removeLock();
    return { status: 'broken', alreadyInstalled: false, error: 'binary not found after install' };
  }

  // Success
  writeManifest('ready', binPath);
  removeLock();
  log(`Runtime ${expectedVersion} installed successfully.`);
  return { status: 'ready', alreadyInstalled: false };
}

function isReady() {
  if (!existsSync(manifestPath)) return false;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    if (manifest.status !== 'ready') return false;
    if (manifest.version !== expectedVersion) return false;
    if (!existsSync(manifest.binPath)) return false;
    return true;
  } catch {
    return false;
  }
}

function writeManifest(status, binPath) {
  const manifest = {
    package: pkgName,
    version: expectedVersion,
    installMode: 'plugin-local',
    installPath: runtimeDir,
    binPath: binPath ?? join(runtimeDir, 'node_modules', '.bin', 'lsp-intelligence'),
    installedAt: new Date().toISOString(),
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    status,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

function removeLock() {
  try { unlinkSync(lockPath); } catch {}
}

// Run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await ensureRuntime();
  process.exit(result.status === 'ready' ? 0 : 1);
}
