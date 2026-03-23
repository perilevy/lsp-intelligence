import { DocumentManager } from './DocumentManager.js';
import type { ResolvedLocation } from './types.js';
export declare class LspEngine {
    private connection;
    private process;
    private capabilities;
    private _ready;
    private _resolveReady;
    private _rejectReady;
    readonly docManager: DocumentManager;
    readonly workspaceRoot: string;
    gitAvailable: boolean;
    constructor(workspaceRoot: string);
    initialize(): Promise<void>;
    /**
     * Send an LSP request. Waits for engine to be ready first.
     */
    request<R>(method: string, params: unknown, timeoutMs?: number): Promise<R>;
    /**
     * Ensure a file is open and return its URI + content.
     */
    prepareFile(filePath: string): Promise<{
        uri: string;
        content: string;
    }>;
    /**
     * Resolve a symbol name to a file position using workspace/symbol.
     */
    resolveSymbol(name: string, fileHint?: string): Promise<ResolvedLocation>;
    /**
     * Discover monorepo packages and open one file per package.
     */
    private preopenPackages;
    /**
     * Discover workspace packages from any monorepo structure.
     * Supports: packages/, apps/, libs/, pnpm-workspace.yaml, lerna.json, rush.json
     */
    private discoverWorkspacePackages;
    /**
     * Build initializationOptions for typescript-language-server.
     * Points tsserver.path to the consumer's TypeScript if available.
     */
    private buildInitOptions;
    /**
     * Resolve a binary — check bundled node_modules/.bin first, then global PATH.
     */
    private resolveBinary;
    private findFirstTsFile;
    shutdown(): Promise<void>;
}
