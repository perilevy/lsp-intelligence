import { spawn, type ChildProcess, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from 'vscode-jsonrpc/node.js';
import type {
  InitializeResult,
  ServerCapabilities,
  Location,
  SymbolInformation,
} from 'vscode-languageserver-protocol';
import { DocumentManager } from './DocumentManager.js';
import { pathToUri, uriToPath } from './positions.js';
import { LspError, LspErrorCode, SKIP_DIRS, DEFAULT_TIMEOUTS } from './types.js';
import type { ResolvedLocation } from './types.js';

export class LspEngine {
  private connection: MessageConnection | null = null;
  private process: ChildProcess | null = null;
  private capabilities: ServerCapabilities | null = null;
  private _ready: Promise<void>;
  private _resolveReady!: () => void;
  private _rejectReady!: (err: Error) => void;

  readonly docManager = new DocumentManager();
  readonly workspaceRoot: string;
  gitAvailable = false;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this._ready = new Promise((resolve, reject) => {
      this._resolveReady = resolve;
      this._rejectReady = reject;
    });
  }

  async initialize(): Promise<void> {
    try {
      // Check git availability
      try {
        execSync('git rev-parse --is-inside-work-tree', { cwd: this.workspaceRoot, stdio: 'pipe' });
        this.gitAvailable = true;
      } catch {
        this.gitAvailable = false;
      }

      // Spawn typescript-language-server — prefer bundled binary, fall back to global
      const tslsBin = this.resolveBinary('typescript-language-server');
      this.process = spawn(tslsBin, ['--stdio'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: this.workspaceRoot,
      });

      if (!this.process.stdout || !this.process.stdin) {
        throw new LspError(LspErrorCode.SERVER_CRASHED, 'Failed to spawn typescript-language-server');
      }

      this.process.stderr?.on('data', () => {}); // suppress stderr
      this.process.on('exit', (code) => {
        console.error(`[lsp-intelligence] TSServer exited with code ${code}`);
        this.connection = null;
      });

      // Create JSON-RPC connection
      this.connection = createMessageConnection(
        new StreamMessageReader(this.process.stdout),
        new StreamMessageWriter(this.process.stdin),
      );
      this.connection.listen();

      // LSP initialize handshake
      const result: InitializeResult = await this.connection.sendRequest('initialize', {
        processId: process.pid,
        rootUri: pathToUri(this.workspaceRoot),
        capabilities: {
          textDocument: {
            synchronization: { dynamicRegistration: false, didSave: true },
            hover: { contentFormat: ['markdown', 'plaintext'] },
            definition: {},
            typeDefinition: {},
            implementation: {},
            references: {},
            documentSymbol: { hierarchicalDocumentSymbolSupport: true },
            rename: { prepareSupport: true },
            publishDiagnostics: { relatedInformation: true },
            callHierarchy: {},
            completion: { completionItem: { snippetSupport: false } },
            codeAction: {},
          },
          workspace: {
            workspaceFolders: true,
            symbol: {},
          },
        },
        workspaceFolders: [{ uri: pathToUri(this.workspaceRoot), name: 'workspace' }],
        initializationOptions: this.buildInitOptions(),
      });

      this.capabilities = result.capabilities;
      this.connection.sendNotification('initialized', {});

      // Handle diagnostics push
      this.connection.onNotification('textDocument/publishDiagnostics', (params: { uri: string; diagnostics: any[] }) => {
        this.docManager.cacheDiagnostics(params.uri, params.diagnostics);
      });

      // Preopen all monorepo packages (non-blocking — resolve ready immediately after)
      await this.preopenPackages();

      // Resolve ready as soon as didOpen notifications are sent.
      // TSServer indexes incrementally — queries retry if needed.
      this._resolveReady();
    } catch (err) {
      this._rejectReady(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  /**
   * Send an LSP request. Waits for engine to be ready first.
   */
  async request<R>(method: string, params: unknown, timeoutMs?: number): Promise<R> {
    await this._ready;
    if (!this.connection) {
      throw new LspError(LspErrorCode.NOT_READY, 'LSP connection not available');
    }

    const timeout = timeoutMs ?? DEFAULT_TIMEOUTS.primitive;
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new LspError(LspErrorCode.TIMEOUT, `${method} timed out after ${timeout}ms`)), timeout),
    );

    return Promise.race([
      this.connection.sendRequest(method, params) as Promise<R>,
      timeoutPromise,
    ]);
  }

  /**
   * Ensure a file is open and return its URI + content.
   */
  async prepareFile(filePath: string): Promise<{ uri: string; content: string }> {
    await this._ready;
    if (!this.connection) throw new LspError(LspErrorCode.NOT_READY, 'LSP connection not available');
    const content = await this.docManager.ensureOpen(filePath, this.connection);
    return { uri: pathToUri(filePath), content };
  }

  /**
   * Resolve a symbol name to a file position using workspace/symbol.
   */
  async resolveSymbol(name: string, fileHint?: string): Promise<ResolvedLocation> {
    await this._ready;

    // Retry up to 5 times with short delays — index builds incrementally
    let symbols: SymbolInformation[] | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      symbols = await this.request('workspace/symbol', { query: name });
      if (symbols && symbols.length > 0) break;
      if (attempt < 4) await new Promise((r) => setTimeout(r, 300));
    }

    if (!symbols || symbols.length === 0) {
      throw new LspError(
        LspErrorCode.SYMBOL_NOT_FOUND,
        `No symbol found matching "${name}"`,
        'Try a more specific name or use file_path + line + column instead.',
      );
    }

    // Priority: exact match > file hint match > first result
    let best = symbols[0];
    for (const sym of symbols) {
      if (sym.name === name) {
        if (fileHint && uriToPath(sym.location.uri).includes(fileHint)) {
          best = sym;
          break;
        }
        best = sym;
      }
    }

    // workspace/symbol returns range.start at the declaration keyword (e.g. "export"),
    // but hover/references need the cursor on the actual symbol name.
    // Read the line and find the exact column of the symbol name.
    const uri = best.location.uri;
    let position = best.location.range.start;
    try {
      const filePath = uriToPath(uri);
      if (this.connection) {
        const content = await this.docManager.ensureOpen(filePath, this.connection);
        const lines = content.split('\n');
        const line = lines[position.line];
        if (line) {
          const nameIndex = line.indexOf(best.name);
          if (nameIndex >= 0) {
            position = { line: position.line, character: nameIndex };
          }
        }
      }
    } catch {}

    return { uri, position, name: best.name };
  }

  /**
   * Discover monorepo packages and open one file per package.
   */
  private async preopenPackages(): Promise<void> {
    const packageDirs = this.discoverWorkspacePackages();
    if (packageDirs.length === 0) return;

    const openPromises: Promise<void>[] = [];

    for (const pkgDir of packageDirs) {
      const filesToOpen: string[] = [];

      // Prefer index.ts / index.tsx in src/ (main exports)
      for (const indexFile of ['src/index.ts', 'src/index.tsx', 'index.ts', 'index.tsx']) {
        const candidate = path.join(pkgDir, indexFile);
        if (fs.existsSync(candidate)) { filesToOpen.push(candidate); break; }
      }

      // Also open any first .ts file if no index found
      if (filesToOpen.length === 0) {
        const srcDir = path.join(pkgDir, 'src');
        const searchDir = fs.existsSync(srcDir) ? srcDir : pkgDir;
        const tsFile = this.findFirstTsFile(searchDir);
        if (tsFile) filesToOpen.push(tsFile);
      }

      for (const tsFile of filesToOpen) {
        if (this.connection) {
          openPromises.push(
            this.docManager.ensureOpen(tsFile, this.connection).then(() => {}),
          );
        }
      }
    }

    await Promise.all(openPromises);

    // Wait until TSServer has indexed at least one project (poll, max 15s)
    const pollStart = Date.now();
    while (Date.now() - pollStart < 15000) {
      try {
        const result = await this.connection!.sendRequest('workspace/symbol', { query: 'a' });
        if (Array.isArray(result) && result.length > 0) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  /**
   * Discover workspace packages from any monorepo structure.
   * Supports: packages/, apps/, libs/, pnpm-workspace.yaml, lerna.json, rush.json
   */
  private discoverWorkspacePackages(): string[] {
    const dirs: string[] = [];

    // Common monorepo directory conventions
    const conventionDirs = ['packages', 'apps', 'libs', 'modules', 'services'];
    for (const dir of conventionDirs) {
      const candidate = path.join(this.workspaceRoot, dir);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        for (const entry of fs.readdirSync(candidate)) {
          const pkgDir = path.join(candidate, entry);
          if (fs.statSync(pkgDir).isDirectory() && !entry.startsWith('.')) {
            dirs.push(pkgDir);
          }
        }
      }
    }

    // If no convention dirs found, check for workspace config files
    if (dirs.length === 0) {
      try {
        // pnpm-workspace.yaml
        const pnpmWs = path.join(this.workspaceRoot, 'pnpm-workspace.yaml');
        if (fs.existsSync(pnpmWs)) {
          const content = fs.readFileSync(pnpmWs, 'utf-8');
          const globs = content.match(/- ['"]?([^'":\n]+)/g);
          if (globs) {
            for (const glob of globs) {
              const pattern = glob.replace(/- ['"]?/, '').replace(/['"]$/, '').replace('/*', '');
              const dir = path.join(this.workspaceRoot, pattern);
              if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
                for (const entry of fs.readdirSync(dir)) {
                  const pkgDir = path.join(dir, entry);
                  if (fs.statSync(pkgDir).isDirectory() && !entry.startsWith('.')) {
                    dirs.push(pkgDir);
                  }
                }
              }
            }
          }
        }

        // package.json workspaces field
        const rootPkg = path.join(this.workspaceRoot, 'package.json');
        if (dirs.length === 0 && fs.existsSync(rootPkg)) {
          const pkg = JSON.parse(fs.readFileSync(rootPkg, 'utf-8'));
          const workspaces = Array.isArray(pkg.workspaces)
            ? pkg.workspaces
            : pkg.workspaces?.packages ?? [];
          for (const ws of workspaces) {
            const pattern = ws.replace('/*', '');
            const dir = path.join(this.workspaceRoot, pattern);
            if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
              for (const entry of fs.readdirSync(dir)) {
                const pkgDir = path.join(dir, entry);
                if (fs.statSync(pkgDir).isDirectory() && !entry.startsWith('.')) {
                  dirs.push(pkgDir);
                }
              }
            }
          }
        }
      } catch {}
    }

    return [...new Set(dirs)];
  }

  /**
   * Build initializationOptions for typescript-language-server.
   * Points tsserver.path to the consumer's TypeScript if available.
   */
  private buildInitOptions(): Record<string, unknown> {
    const consumerTsPath = path.join(this.workspaceRoot, 'node_modules', 'typescript', 'lib');
    if (fs.existsSync(consumerTsPath)) {
      return { tsserver: { path: consumerTsPath } };
    }
    return {};
  }

  /**
   * Resolve a binary — check bundled node_modules/.bin first, then global PATH.
   */
  private resolveBinary(name: string): string {
    // Check our own node_modules/.bin (bundled dependency)
    const localBin = path.resolve(import.meta.dirname, '..', '..', 'node_modules', '.bin', name);
    if (fs.existsSync(localBin)) return localBin;
    // Fall back to global PATH
    return name;
  }

  private findFirstTsFile(dir: string, depth = 0): string | null {
    if (depth > 4) return null;
    try {
      for (const entry of fs.readdirSync(dir)) {
        if (SKIP_DIRS.has(entry)) continue;
        const full = path.join(dir, entry);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          const found = this.findFirstTsFile(full, depth + 1);
          if (found) return found;
        } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
          return full;
        }
      }
    } catch {}
    return null;
  }

  async shutdown(): Promise<void> {
    // Suppress stream write errors during teardown (TSServer may write after dispose)
    this.process?.stdin?.on('error', () => {});
    this.process?.stdout?.on('error', () => {});
    if (this.connection) {
      try {
        await this.connection.sendRequest('shutdown');
        this.connection.sendNotification('exit');
      } catch {}
      this.connection.dispose();
    }
    this.process?.kill();
  }
}
