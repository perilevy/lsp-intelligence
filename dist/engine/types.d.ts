import type { Diagnostic, Location, Position } from 'vscode-languageserver-protocol';
export declare enum LspErrorCode {
    NOT_READY = "NOT_READY",
    TIMEOUT = "TIMEOUT",
    SYMBOL_NOT_FOUND = "SYMBOL_NOT_FOUND",
    FILE_NOT_FOUND = "FILE_NOT_FOUND",
    CAPABILITY_MISSING = "CAPABILITY_MISSING",
    SERVER_CRASHED = "SERVER_CRASHED",
    GIT_UNAVAILABLE = "GIT_UNAVAILABLE"
}
export declare class LspError extends Error {
    code: LspErrorCode;
    suggestion?: string | undefined;
    constructor(code: LspErrorCode, message: string, suggestion?: string | undefined);
}
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
export interface ResolvedLocation {
    uri: string;
    position: Position;
    name?: string;
}
export interface ReferenceResult {
    uri: string;
    range: {
        start: Position;
        end: Position;
    };
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
export declare const SKIP_DIRS: Set<string>;
export declare const DEFAULT_TIMEOUTS: {
    readonly primitive: 10000;
    readonly composite: 20000;
    readonly context: 30000;
    readonly live: 10000;
};
