import * as fs from 'fs';
import type { MessageConnection } from 'vscode-jsonrpc';
import type { Diagnostic } from 'vscode-languageserver-protocol';
import { pathToUri, uriToPath } from './positions.js';

interface OpenDocument {
  uri: string;
  version: number;
  content: string;
  languageId: string;
}

export class DocumentManager {
  private openDocs = new Map<string, OpenDocument>();
  private diagnosticsCache = new Map<string, Diagnostic[]>();

  /**
   * Ensure a file is open in the LSP server. If already open, no-op.
   * Returns the file content.
   */
  async ensureOpen(filePath: string, connection: MessageConnection): Promise<string> {
    const uri = pathToUri(filePath);
    const existing = this.openDocs.get(uri);
    if (existing) return existing.content;

    const content = fs.readFileSync(uriToPath(uri), 'utf-8');
    const languageId = this.detectLanguage(filePath);

    const doc: OpenDocument = { uri, version: 1, content, languageId };
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
  async refreshFromDisk(filePath: string, connection: MessageConnection): Promise<string> {
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
    } else {
      await this.ensureOpen(filePath, connection);
    }

    return content;
  }

  getContent(uri: string): string | undefined {
    return this.openDocs.get(uri)?.content;
  }

  isOpen(uri: string): boolean {
    return this.openDocs.has(uri);
  }

  cacheDiagnostics(uri: string, diagnostics: Diagnostic[]): void {
    this.diagnosticsCache.set(uri, diagnostics);
  }

  getCachedDiagnostics(uri: string): Diagnostic[] {
    return this.diagnosticsCache.get(uri) ?? [];
  }

  private detectLanguage(filePath: string): string {
    if (filePath.endsWith('.tsx')) return 'typescriptreact';
    if (filePath.endsWith('.ts')) return 'typescript';
    if (filePath.endsWith('.jsx')) return 'javascriptreact';
    if (filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs')) return 'javascript';
    return 'typescript';
  }
}
