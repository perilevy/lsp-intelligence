import * as fs from 'fs';

/**
 * Build a code snippet around a specific line, with optional context.
 */
export function buildSnippet(
  sourceText: string,
  line: number,
  column?: number,
  contextLines: number = 1,
): { snippet: string; context: string } {
  const lines = sourceText.split('\n');
  const line0 = line - 1; // Convert 1-indexed to 0-indexed
  const start = Math.max(0, line0 - contextLines);
  const end = Math.min(lines.length - 1, line0 + contextLines);

  const snippet = lines[line0]?.trim() ?? '';
  const context = lines
    .slice(start, end + 1)
    .map((l, i) => `${start + i + 1}| ${l}`)
    .join('\n');

  return { snippet, context };
}

/**
 * Build a snippet from a file path + line.
 */
export function buildSnippetFromFile(
  filePath: string,
  line: number,
  contextLines: number = 1,
): { snippet: string; context: string } {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return buildSnippet(content, line, undefined, contextLines);
  } catch {
    return { snippet: '', context: '' };
  }
}
