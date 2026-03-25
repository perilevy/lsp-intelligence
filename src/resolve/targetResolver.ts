import type { LspEngine } from '../engine/LspEngine.js';
import { toPosition, pathToUri } from '../engine/positions.js';

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
 * Priority: symbol+file_path > symbol > file_path+line > file_path alone
 */
export async function resolveTarget(input: ToolTargetInput, engine: LspEngine): Promise<ResolvedTarget> {
  // Priority 1: symbol (with optional file hint)
  if (input.symbol) {
    const resolved = await engine.resolveSymbol(input.symbol, input.file_path);
    return {
      symbol: resolved.name,
      uri: resolved.uri,
      filePath: resolved.uri.replace('file://', ''),
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
    const match = diags.find((d) => `TS${d.code}` === input.diagnostic_code || String(d.code) === input.diagnostic_code);
    if (match) {
      return {
        uri,
        filePath: input.file_path,
        position: match.range.start,
        confidence: 'high',
      };
    }
    // Fall through to file-only
  }

  // Priority 4: file_path alone (position at line 1)
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
