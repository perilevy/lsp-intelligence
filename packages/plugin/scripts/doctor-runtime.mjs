#!/usr/bin/env node
/**
 * Diagnose lsp-intelligence runtime health.
 * Prints all relevant state for debugging.
 */

import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(__dirname, '..');
const runtimeDir = join(pluginRoot, '.runtime');
const manifestPath = join(runtimeDir, 'manifest.json');
const lockPath = join(runtimeDir, 'install.lock');
const runtimeConfigPath = join(pluginRoot, 'runtime.json');

console.log('');
console.log('  lsp-intelligence runtime doctor');
console.log('  ==============================');
console.log('');

// Plugin root
console.log(`  Plugin root:     ${pluginRoot}`);
console.log(`  Runtime dir:     ${runtimeDir}`);
console.log(`  Node version:    ${process.version}`);
console.log(`  Platform:        ${process.platform}/${process.arch}`);
console.log('');

// Runtime config
if (existsSync(runtimeConfigPath)) {
  const config = JSON.parse(readFileSync(runtimeConfigPath, 'utf-8')).runtime;
  console.log(`  Expected package: ${config.package}@${config.version}`);
  console.log(`  Node required:    ${config.node}`);
  console.log(`  Global fallback:  ${config.allowGlobalFallback}`);
} else {
  console.log('  ✗ runtime.json MISSING');
}
console.log('');

// Manifest
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  console.log(`  Manifest status:  ${manifest.status}`);
  console.log(`  Installed ver:    ${manifest.version}`);
  console.log(`  Install mode:     ${manifest.installMode}`);
  console.log(`  Bin path:         ${manifest.binPath}`);
  console.log(`  Bin exists:       ${existsSync(manifest.binPath)}`);
  console.log(`  Installed at:     ${manifest.installedAt}`);
  console.log(`  Node at install:  ${manifest.nodeVersion}`);
  console.log(`  Platform/arch:    ${manifest.platform}/${manifest.arch}`);
} else {
  console.log('  ✗ manifest.json MISSING — runtime not installed');
}
console.log('');

// Lock
if (existsSync(lockPath)) {
  const lock = JSON.parse(readFileSync(lockPath, 'utf-8'));
  console.log(`  ⚠ Install lock exists (pid: ${lock.pid}, started: ${lock.startedAt})`);
} else {
  console.log('  No install lock.');
}

// Global
try {
  const globalBin = execSync('which lsp-intelligence', { encoding: 'utf-8', timeout: 3000 }).trim();
  if (globalBin) {
    console.log(`  Global binary:    ${globalBin}`);
    try {
      const ver = execSync(`${globalBin} --version`, { encoding: 'utf-8', timeout: 3000 }).trim();
      console.log(`  Global version:   ${ver}`);
    } catch {
      console.log('  Global version:   (could not determine)');
    }
  }
} catch {
  console.log('  Global binary:    not found on PATH');
}

// Registry
console.log('');
try {
  const registry = execSync('npm config get registry', { encoding: 'utf-8', timeout: 5000 }).trim();
  console.log(`  npm registry:     ${registry}`);
} catch {
  console.log('  npm registry:     (could not determine)');
}

console.log('');
