#!/usr/bin/env node
/**
 * Ensure the plugin's npm dependencies are installed.
 *
 * Claude Code extracts the npm tarball but does not run `npm install`
 * for the package's dependencies. This script fills that gap — it runs
 * once on first SessionStart and is a no-op on every subsequent start.
 *
 * Marker: node_modules/@modelcontextprotocol (core dep, always present
 * after a successful install).
 */
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const marker = join(pluginRoot, 'node_modules', '@modelcontextprotocol');

if (!existsSync(marker)) {
  console.error('[lsp-intelligence] Installing dependencies (first run)...');
  execSync('npm install --ignore-scripts', { cwd: pluginRoot, stdio: 'inherit' });
  console.error('[lsp-intelligence] Dependencies ready.');
}
