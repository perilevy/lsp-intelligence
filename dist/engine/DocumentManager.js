import * as fs from 'fs';
import { pathToUri, uriToPath } from './positions.js';
export class DocumentManager {
    openDocs = new Map();
    diagnosticsCache = new Map();
    /**
     * Ensure a file is open in the LSP server. If already open, no-op.
     * Returns the file content.
     */
    async ensureOpen(filePath, connection) {
        const uri = pathToUri(filePath);
        const existing = this.openDocs.get(uri);
        if (existing)
            return existing.content;
        const content = fs.readFileSync(uriToPath(uri), 'utf-8');
        const languageId = this.detectLanguage(filePath);
        const doc = { uri, version: 1, content, languageId };
        this.openDocs.set(uri, doc);
        connection.sendNotification('textDocument/didOpen', {
            textDocument: {
                uri,
                languageId,
                version: doc.version,
                text: content,
            },
        });
        return content;
    }
    /**
     * Re-read a file from disk and send didChange. For live diagnostics after edits.
     */
    async refreshFromDisk(filePath, connection) {
        const uri = pathToUri(filePath);
        const content = fs.readFileSync(uriToPath(uri), 'utf-8');
        const existing = this.openDocs.get(uri);
        if (existing) {
            existing.version++;
            existing.content = content;
            connection.sendNotification('textDocument/didChange', {
                textDocument: { uri, version: existing.version },
                contentChanges: [{ text: content }],
            });
        }
        else {
            await this.ensureOpen(filePath, connection);
        }
        return content;
    }
    getContent(uri) {
        return this.openDocs.get(uri)?.content;
    }
    isOpen(uri) {
        return this.openDocs.has(uri);
    }
    cacheDiagnostics(uri, diagnostics) {
        this.diagnosticsCache.set(uri, diagnostics);
    }
    getCachedDiagnostics(uri) {
        return this.diagnosticsCache.get(uri) ?? [];
    }
    detectLanguage(filePath) {
        if (filePath.endsWith('.tsx'))
            return 'typescriptreact';
        if (filePath.endsWith('.ts'))
            return 'typescript';
        if (filePath.endsWith('.jsx'))
            return 'javascriptreact';
        if (filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs'))
            return 'javascript';
        return 'typescript';
    }
}
//# sourceMappingURL=DocumentManager.js.map