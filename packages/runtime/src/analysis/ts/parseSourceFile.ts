import ts from 'typescript';
import * as fs from 'fs';
import { scriptKindForFile } from '../../search/fileKinds.js';

/**
 * Parse a TypeScript/JavaScript file into a ts.SourceFile using the TypeScript compiler API.
 * Supports: .ts, .tsx, .js, .jsx, .mjs, .cjs
 *
 * @param text - Optional overlay text. If provided, skips disk read and parses this content
 *               instead. Used by Phase 2A snapshot-aware indexing for unsaved-buffer support.
 *
 * Returns null if the file doesn't exist or can't be parsed.
 */
export function parseSourceFile(filePath: string, text?: string): ts.SourceFile | null {
  try {
    const content = text ?? fs.readFileSync(filePath, 'utf-8');
    return ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, scriptKindForFile(filePath));
  } catch {
    return null;
  }
}

/**
 * Parse source content directly (for base-version comparison).
 */
export function parseSourceContent(content: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true, scriptKindForFile(fileName));
}
