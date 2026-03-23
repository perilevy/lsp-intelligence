import type { Location, Hover, MarkupContent, DocumentSymbol, SymbolInformation } from 'vscode-languageserver-protocol';
import { fromPosition, uriToPath, relativePath } from '../engine/positions.js';
import type { Verbosity } from '../engine/types.js';
import * as fs from 'fs';

export function formatReferences(
  locations: Location[] | null,
  workspaceRoot: string,
  verbosity: Verbosity = 'normal',
): string {
  if (!locations || locations.length === 0) return 'No references found.';

  // Group by file
  const byFile = new Map<string, Location[]>();
  for (const loc of locations) {
    const file = uriToPath(loc.uri);
    const existing = byFile.get(file) ?? [];
    existing.push(loc);
    byFile.set(file, existing);
  }

  const totalFiles = byFile.size;
  const totalRefs = locations.length;
  const summary = `${totalRefs} references across ${totalFiles} files`;

  if (verbosity === 'summary') return summary;

  const lines: string[] = [`# References\n\n${summary}\n`];

  for (const [file, refs] of [...byFile.entries()].sort()) {
    const rel = relativePath(file, workspaceRoot);
    lines.push(`## ${rel} (${refs.length})\n`);

    for (const ref of refs.sort((a, b) => a.range.start.line - b.range.start.line)) {
      const pos = fromPosition(ref.range.start);
      if (verbosity === 'detailed') {
        const context = getContextLines(file, ref.range.start.line, 1);
        lines.push(`### L${pos.line}\n\`\`\`\n${context}\n\`\`\`\n`);
      } else {
        const context = getLineContent(file, ref.range.start.line);
        lines.push(`- L${pos.line}: \`${context.trim()}\``);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function formatDefinitions(
  locations: Location | Location[] | null,
  workspaceRoot: string,
): string {
  if (!locations) return 'No definition found.';
  const locs = Array.isArray(locations) ? locations : [locations];
  if (locs.length === 0) return 'No definition found.';

  const lines: string[] = ['# Definition\n'];
  for (const loc of locs) {
    const rel = relativePath(uriToPath(loc.uri), workspaceRoot);
    const pos = fromPosition(loc.range.start);
    const context = getContextLines(uriToPath(loc.uri), loc.range.start.line, 2);
    lines.push(`**${rel}:${pos.line}**\n\`\`\`\n${context}\n\`\`\`\n`);
  }

  return lines.join('\n');
}

export function formatHover(hover: Hover | null): string {
  if (!hover) return 'No hover information available.';

  const contents = hover.contents;
  if (typeof contents === 'string') return contents;
  if ('kind' in contents) return (contents as MarkupContent).value;
  if ('language' in contents) return `\`\`\`${contents.language}\n${contents.value}\n\`\`\``;

  return String(contents);
}

function getLineContent(filePath: string, line0: number): string {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    return lines[line0] ?? '';
  } catch {
    return '';
  }
}

function getContextLines(filePath: string, line0: number, context: number): string {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const start = Math.max(0, line0 - context);
    const end = Math.min(lines.length - 1, line0 + context);
    return lines
      .slice(start, end + 1)
      .map((l, i) => `${start + i + 1}| ${l}`)
      .join('\n');
  } catch {
    return '';
  }
}
