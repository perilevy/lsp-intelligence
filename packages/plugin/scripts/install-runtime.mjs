#!/usr/bin/env node
/**
 * Install or update the lsp-intelligence runtime.
 * User-facing CLI — shows progress and clear success/failure messages.
 */

import { ensureRuntime } from './ensure-runtime.mjs';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(__dirname, '..');
const runtimeConfig = JSON.parse(readFileSync(join(pluginRoot, 'runtime.json'), 'utf-8')).runtime;

console.log('');
console.log(`  lsp-intelligence runtime installer`);
console.log(`  Package: ${runtimeConfig.package}@${runtimeConfig.version}`);
console.log(`  Node: ${process.version}`);
console.log(`  Platform: ${process.platform}/${process.arch}`);
console.log('');

const result = await ensureRuntime({ silent: false });

console.log('');
if (result.status === 'ready') {
  if (result.alreadyInstalled) {
    console.log('  ✓ Runtime already installed and ready.');
  } else {
    console.log('  ✓ Runtime installed successfully.');
  }
  console.log('');
  console.log('  The MCP server will start automatically on next /reload-plugins.');
} else if (result.status === 'installing') {
  console.log('  ⏳ Another install is in progress. Please wait and retry.');
} else {
  console.log(`  ✗ Installation failed: ${result.error ?? 'unknown error'}`);
  console.log('');
  console.log('  Troubleshooting:');
  console.log('    1. Check your network/registry access');
  console.log('    2. Run: node scripts/doctor-runtime.mjs');
  console.log(`    3. Or install globally: npm install -g ${runtimeConfig.package}@${runtimeConfig.version}`);
}
console.log('');

process.exit(result.status === 'ready' ? 0 : 1);
