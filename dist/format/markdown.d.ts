import type { Location, Hover } from 'vscode-languageserver-protocol';
import type { Verbosity } from '../engine/types.js';
export declare function formatReferences(locations: Location[] | null, workspaceRoot: string, verbosity?: Verbosity): string;
export declare function formatDefinitions(locations: Location | Location[] | null, workspaceRoot: string): string;
export declare function formatHover(hover: Hover | null): string;
