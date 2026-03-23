import type { MessageConnection } from 'vscode-jsonrpc';
import type { Diagnostic } from 'vscode-languageserver-protocol';
export declare class DocumentManager {
    private openDocs;
    private diagnosticsCache;
    /**
     * Ensure a file is open in the LSP server. If already open, no-op.
     * Returns the file content.
     */
    ensureOpen(filePath: string, connection: MessageConnection): Promise<string>;
    /**
     * Re-read a file from disk and send didChange. For live diagnostics after edits.
     */
    refreshFromDisk(filePath: string, connection: MessageConnection): Promise<string>;
    getContent(uri: string): string | undefined;
    isOpen(uri: string): boolean;
    cacheDiagnostics(uri: string, diagnostics: Diagnostic[]): void;
    getCachedDiagnostics(uri: string): Diagnostic[];
    private detectLanguage;
}
