import ts from 'typescript';
import * as fs from 'fs';

/**
 * Parse a TypeScript/TSX file into a ts.SourceFile using the TypeScript compiler API.
 * Returns null if the file doesn't exist or can't be parsed.
 */
export function parseSourceFile(filePath: string): ts.SourceFile | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const scriptKind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX
      : filePath.endsWith('.jsx') ? ts.ScriptKind.JSX
      : ts.ScriptKind.TS;
    return ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, scriptKind);
  } catch {
    return null;
  }
}

/**
 * Parse source content directly (for base-version comparison).
 */
export function parseSourceContent(content: string, fileName: string): ts.SourceFile {
  const scriptKind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX
    : fileName.endsWith('.jsx') ? ts.ScriptKind.JSX
    : ts.ScriptKind.TS;
  return ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true, scriptKind);
}
