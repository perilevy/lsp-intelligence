#!/usr/bin/env node
/**
 * lsp-intelligence plugin launcher.
 *
 * Runs from the plugin-installed package directory.
 * Fast: no network, no install, no dependency resolution.
 * Just finds dist/index.js and spawns it.
 *
 * LSP_WORKSPACE_ROOT defaults to process.cwd() which Claude Code sets to
 * the current workspace when starting MCP servers.
 */
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, '..', 'dist', 'index.js');

const child = spawn(process.execPath, [serverPath], {
  stdio: 'inherit',
  env: {
    ...process.env,
    LSP_WORKSPACE_ROOT: process.env.LSP_WORKSPACE_ROOT ?? process.cwd(),
  },
});

child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
