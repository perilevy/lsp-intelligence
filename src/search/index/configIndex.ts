import * as fs from 'fs';
import * as path from 'path';
import type { ConfigIndexEntry, SearchScope } from '../types.js';
import { SKIP_DIRS } from '../../engine/types.js';
import { isConfigFile } from '../fileKinds.js';

const CONFIG_EXTENSIONS = ['.json', '.yaml', '.yml', '.env', '.toml'];
const CONFIG_FILENAMES = [
  'package.json', 'tsconfig.json', 'next.config.js', 'next.config.ts',
  'vite.config.ts', 'vite.config.js', 'jest.config.ts', 'jest.config.js',
  'vitest.config.ts', '.env', '.env.local', '.env.production',
];

/**
 * Index configuration files in the workspace.
 * Extracts key-value entries from JSON, YAML-like, and env files.
 */
export function indexConfigFiles(scope: SearchScope): ConfigIndexEntry[] {
  const entries: ConfigIndexEntry[] = [];
  const maxFiles = 200;
  const files: string[] = [];

  for (const root of scope.roots) {
    collectConfigFiles(root, files, maxFiles, 0);
  }

  for (const filePath of files) {
    try {
      const ext = path.extname(filePath);
      const basename = path.basename(filePath);

      if (basename === 'package.json') {
        entries.push(...indexPackageJson(filePath));
      } else if (ext === '.json') {
        entries.push(...indexJsonFile(filePath));
      } else if (basename.startsWith('.env')) {
        entries.push(...indexEnvFile(filePath));
      } else if (ext === '.yaml' || ext === '.yml') {
        entries.push(...indexYamlLikeFile(filePath));
      }
    } catch {
      // Skip files that can't be read/parsed
    }
  }

  return entries;
}

function collectConfigFiles(dir: string, files: string[], maxFiles: number, depth: number): void {
  if (depth > 4 || files.length >= maxFiles) return;
  try {
    for (const entry of fs.readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = path.join(dir, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        collectConfigFiles(full, files, maxFiles, depth + 1);
      } else if (
        CONFIG_FILENAMES.includes(entry) ||
        CONFIG_EXTENSIONS.some((e) => entry.endsWith(e)) ||
        entry.startsWith('.env')
      ) {
        files.push(full);
      }
    }
  } catch {}
}

function indexPackageJson(filePath: string): ConfigIndexEntry[] {
  const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const entries: ConfigIndexEntry[] = [];

  // Scripts
  if (content.scripts) {
    for (const [key, value] of Object.entries(content.scripts)) {
      entries.push({
        filePath, line: 1, kind: 'package',
        keyPath: ['scripts', key],
        text: `${key}: ${value}`,
        tokens: tokenize(`${key} ${value}`),
      });
    }
  }

  // Dependencies
  for (const depKey of ['dependencies', 'devDependencies', 'peerDependencies']) {
    if (content[depKey]) {
      for (const pkg of Object.keys(content[depKey])) {
        entries.push({
          filePath, line: 1, kind: 'package',
          keyPath: [depKey, pkg],
          text: `${depKey}: ${pkg}`,
          tokens: tokenize(pkg),
        });
      }
    }
  }

  return entries;
}

function indexJsonFile(filePath: string): ConfigIndexEntry[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const entries: ConfigIndexEntry[] = [];

  try {
    const obj = JSON.parse(content);
    flattenJson(obj, [], filePath, entries, 0);
  } catch {}

  return entries;
}

function flattenJson(
  obj: any, keyPath: string[], filePath: string,
  entries: ConfigIndexEntry[], depth: number,
): void {
  if (depth > 4 || entries.length > 100) return;
  if (typeof obj !== 'object' || obj === null) return;

  for (const [key, value] of Object.entries(obj)) {
    const path = [...keyPath, key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      entries.push({
        filePath, line: 1, kind: 'config',
        keyPath: path,
        text: `${path.join('.')}: ${value}`,
        tokens: tokenize(`${key} ${value}`),
      });
    } else if (typeof value === 'object' && value !== null) {
      flattenJson(value, path, filePath, entries, depth + 1);
    }
  }
}

function indexEnvFile(filePath: string): ConfigIndexEntry[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const entries: ConfigIndexEntry[] = [];

  for (const [i, rawLine] of content.split('\n').entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx < 1) continue;

    const key = line.substring(0, eqIdx).trim();
    const value = line.substring(eqIdx + 1).trim();
    entries.push({
      filePath, line: i + 1, kind: 'env',
      keyPath: [key],
      text: `${key}=${value}`,
      tokens: tokenize(`${key} ${value}`),
    });
  }

  return entries;
}

function indexYamlLikeFile(filePath: string): ConfigIndexEntry[] {
  // Simple line-based YAML indexing — not a full parser
  const content = fs.readFileSync(filePath, 'utf-8');
  const entries: ConfigIndexEntry[] = [];

  for (const [i, rawLine] of content.split('\n').entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const colonIdx = line.indexOf(':');
    if (colonIdx < 1) continue;

    const key = line.substring(0, colonIdx).trim();
    const value = line.substring(colonIdx + 1).trim();
    if (value) {
      entries.push({
        filePath, line: i + 1, kind: 'config',
        keyPath: [key],
        text: `${key}: ${value}`,
        tokens: tokenize(`${key} ${value}`),
      });
    }
  }

  return entries;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-_]/g, ' ')
    .split(/[\s-_]+/)
    .filter((t) => t.length > 1);
}
