import type { LspEngine } from '../engine/LspEngine.js';
import type { Diagnostic } from 'vscode-languageserver-protocol';
import { toPosition, uriToPath } from '../engine/positions.js';

export interface ToolTargetInput {
  symbol?: string;
  file_path?: string;
  line?: number;
  column?: number;
  diagnostic_code?: string;
}

export interface ResolvedTarget {
  symbol?: string;
  uri: string;
  filePath: string;
  position: { line: number; character: number };
  definitionFilePath?: string;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Resolve a tool input into a canonical target with file + position.
 * Priority: symbol+file_path > symbol > file_path+line > file_path+diagnostic_code > file_path alone
 */
export async function resolveTarget(input: ToolTargetInput, engine: LspEngine): Promise<ResolvedTarget> {
  // Priority 1: symbol (with optional file hint)
  if (input.symbol) {
    const resolved = await engine.resolveSymbol(input.symbol, input.file_path);
    return {
      symbol: resolved.name,
      uri: resolved.uri,
      filePath: uriToPath(resolved.uri),
      position: resolved.position,
      confidence: 'high',
    };
  }

  // Priority 2: file_path + line
  if (input.file_path && input.line) {
    const { uri } = await engine.prepareFile(input.file_path);
    const position = toPosition(input.line, input.column ?? 1);
    return {
      uri,
      filePath: input.file_path,
      position,
      confidence: 'medium',
    };
  }

  // Priority 3: file_path + diagnostic_code
  if (input.file_path && input.diagnostic_code) {
    const { uri } = await engine.prepareFile(input.file_path);
    await new Promise((r) => setTimeout(r, 500));
    const diags = engine.docManager.getCachedDiagnostics(uri);
    const match = diags.find((d) =>
      `TS${d.code}` === input.diagnostic_code || String(d.code) === input.diagnostic_code,
    );
    if (match) {
      return {
        uri,
        filePath: input.file_path,
        position: match.range.start,
        confidence: 'high',
      };
    }
  }

  // Priority 4: file_path alone
  if (input.file_path) {
    const { uri } = await engine.prepareFile(input.file_path);
    return {
      uri,
      filePath: input.file_path,
      position: { line: 0, character: 0 },
      confidence: 'low',
    };
  }

  throw new Error('Provide at least a symbol name or file_path.');
}

/**
 * Pick the best diagnostic near a position.
 * Priority: exact code match > exact line > nearest ±2 > first error
 */
export function pickDiagnostic(
  diagnostics: Diagnostic[],
  position: { line: number; character: number },
  diagnosticCode?: string,
): Diagnostic | undefined {
  const errors = diagnostics.filter((d) => d.severity === 1);
  if (errors.length === 0) return undefined;

  // Exact diagnostic code match
  if (diagnosticCode) {
    const byCode = errors.find((d) =>
      `TS${d.code}` === diagnosticCode || String(d.code) === diagnosticCode,
    );
    if (byCode) return byCode;
  }

  // Exact line match
  const byLine = errors.find((d) => d.range.start.line === position.line);
  if (byLine) return byLine;

  // Nearest line within ±2
  const nearby = errors
    .filter((d) => Math.abs(d.range.start.line - position.line) <= 2)
    .sort((a, b) => Math.abs(a.range.start.line - position.line) - Math.abs(b.range.start.line - position.line));
  if (nearby.length > 0) return nearby[0];

  // First error
  return errors[0];
}
