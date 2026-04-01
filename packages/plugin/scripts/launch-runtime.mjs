#!/usr/bin/env node
/**
 * Launch the lsp-intelligence runtime.
 * This is the ONLY thing .mcp.json should call.
 *
 * Rules:
 * - Never installs anything
 * - Never does network
 * - Fast launch if runtime exists
 * - Fast failure with guidance if not
 *
 * Resolution order:
 * 1. LSP_INTELLIGENCE_BIN env override
 * 2. Plugin-local runtime (.runtime/node_modules/.bin/lsp-intelligence)
 * 3. Global lsp-intelligence on PATH (if allowGlobalFallback)
 * 4. Fail with install instructions
 */

import { execSync, spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(__dirname, '..');
const runtimeDir = join(pluginRoot, '.runtime');
const runtimeConfigPath = join(pluginRoot, 'runtime.json');
const manifestPath = join(runtimeDir, 'manifest.json');

// Read runtime config
let runtimeConfig;
try {
  runtimeConfig = JSON.parse(readFileSync(runtimeConfigPath, 'utf-8')).runtime;
} catch {
  console.error('[lsp-intelligence] ERROR: Missing runtime.json');
  process.exit(127);
}

const expectedVersion = runtimeConfig.version;
const allowGlobal = runtimeConfig.allowGlobalFallback ?? true;

// --- Resolution ---

function findBin() {
  // 1. Env override
  const override = process.env.LSP_INTELLIGENCE_BIN;
  if (override && existsSync(override)) return override;

  // 2. Plugin-local runtime
  const localBin = join(runtimeDir, 'node_modules', '.bin', 'lsp-intelligence');
  if (existsSync(localBin)) {
    // Check manifest version
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        if (manifest.status === 'ready' && manifest.version === expectedVersion) {
          return localBin;
        }
        if (manifest.status === 'installing') {
          console.error('[lsp-intelligence] Runtime is currently being installed. Please wait and retry.');
          process.exit(127);
        }
        if (manifest.version !== expectedVersion) {
          console.error(`[lsp-intelligence] Runtime version mismatch: installed ${manifest.version}, expected ${expectedVersion}`);
          console.error(`Run: node ${join(pluginRoot, 'scripts', 'install-runtime.mjs')}`);
          process.exit(127);
        }
      } catch {}
    }
    // Manifest missing but bin exists — try anyway
    return localBin;
  }

  // 3. Global fallback
  if (allowGlobal) {
    try {
      const globalBin = execSync('which lsp-intelligence', { encoding: 'utf-8', timeout: 3000 }).trim();
      if (globalBin && existsSync(globalBin)) {
        // Optional: check version
        try {
          const ver = execSync(`${globalBin} --version`, { encoding: 'utf-8', timeout: 3000 }).trim();
          if (ver && ver !== expectedVersion) {
            console.error(`[lsp-intelligence] Global runtime version ${ver} does not match expected ${expectedVersion}`);
            console.error('Using it anyway. For exact version, run:');
            console.error(`  node ${join(pluginRoot, 'scripts', 'install-runtime.mjs')}`);
          }
        } catch {}
        return globalBin;
      }
    } catch {}
  }

  return null;
}

const bin = findBin();

if (!bin) {
  console.error('[lsp-intelligence] Runtime not found.');
  console.error('');
  console.error('To install the runtime, run:');
  console.error(`  node ${join(pluginRoot, 'scripts', 'install-runtime.mjs')}`);
  console.error('');
  console.error('Or install globally:');
  console.error(`  npm install -g lsp-intelligence@${expectedVersion}`);
  process.exit(127);
}

// --- Launch ---

// Pass through LSP_WORKSPACE_ROOT from the environment or use PWD
const env = { ...process.env };
if (!env.LSP_WORKSPACE_ROOT) {
  env.LSP_WORKSPACE_ROOT = process.cwd();
}

const child = spawn(bin, [], {
  stdio: 'inherit',
  env,
});

child.on('exit', (code) => process.exit(code ?? 1));
child.on('error', (err) => {
  console.error(`[lsp-intelligence] Failed to launch runtime: ${err.message}`);
  process.exit(1);
});
