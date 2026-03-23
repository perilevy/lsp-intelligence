import type { Diagnostic, Location, Position } from 'vscode-languageserver-protocol';

// --- Error types ---

export enum LspErrorCode {
  NOT_READY = 'NOT_READY',
  TIMEOUT = 'TIMEOUT',
  SYMBOL_NOT_FOUND = 'SYMBOL_NOT_FOUND',
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  CAPABILITY_MISSING = 'CAPABILITY_MISSING',
  SERVER_CRASHED = 'SERVER_CRASHED',
  GIT_UNAVAILABLE = 'GIT_UNAVAILABLE',
}

export class LspError extends Error {
  constructor(
    public code: LspErrorCode,
    message: string,
    public suggestion?: string,
  ) {
    super(message);
    this.name = 'LspError';
  }
}

// --- Tool input types ---

export interface SymbolInput {
  input_type: 'symbol';
  symbol: string;
  file_path?: string;
}

export interface PositionInput {
  input_type: 'position';
  file_path: string;
  line: number;
  column: number;
}

export type SymbolOrPosition = SymbolInput | PositionInput;

export type Verbosity = 'summary' | 'normal' | 'detailed';

// --- Result types ---

export interface ResolvedLocation {
  uri: string;
  position: Position;
  name?: string;
}

export interface ReferenceResult {
  uri: string;
  range: { start: Position; end: Position };
  kind?: 'definition' | 'import' | 'call' | 'type_annotation' | 're_export' | 'other';
  context?: string;
}

export interface ImpactNode {
  uri: string;
  position: Position;
  name: string;
  depth: number;
  references: Location[];
  isTypeAlias: boolean;
}

export interface DiagnosticEntry {
  uri: string;
  diagnostics: Diagnostic[];
}

// --- Constants ---

export const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'es', '.cache', '.git',
  '__pycache__', '.next', '.turbo', 'coverage',
]);

export const DEFAULT_TIMEOUTS = {
  primitive: 10_000,
  composite: 20_000,
  context: 30_000,
  live: 10_000,
} as const;
