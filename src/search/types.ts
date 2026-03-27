// ============================================================================
// Query IR — the parsed representation of a user's search query
// ============================================================================

export type StructuralPredicate =
  | 'conditional'
  | 'returns-function'
  | 'returns-cleanup'
  | 'no-cleanup'
  | 'has-try-catch'
  | 'no-try-catch'
  | 'switch-no-default'
  | 'await-in-loop'
  | 'inside-hook'
  | 'hook-callback';

export interface QueryTraits {
  routeLike: boolean;
  configLike: boolean;
  implementationRoot: boolean;
  testIntent: boolean;
}

export interface QueryIR {
  raw: string;

  /** Natural-language tokens (lowercased, stop-words removed) */
  nlTokens: string[];
  /** Multi-word phrases preserved from the query */
  phrases: string[];

  /** Exact identifiers: useEffect, AbortController, useMemo */
  exactIdentifiers: string[];
  /** Dotted identifiers: Promise.all, React.useEffect */
  dottedIdentifiers: string[];
  /** Code-oriented tokens that aren't exact identifiers: cleanup, callback */
  codeTokens: string[];

  /** Per-family relevance scores */
  familyScores: Record<string, number>;

  /** Structural predicates inferred from the query */
  structuralPredicates: StructuralPredicate[];

  /** Semantic traits inferred from the query */
  traits: QueryTraits;

  /** Routing mode */
  mode: 'behavior' | 'identifier' | 'structural' | 'mixed';
  modeConfidence: 'high' | 'medium' | 'low';
  routingReasons: string[];
}

// ============================================================================
// Search plan — how the orchestrator will execute the query
// ============================================================================

export interface SearchPlan {
  mode: 'behavior' | 'identifier' | 'structural' | 'mixed';
  retrievers: Array<'behavior' | 'identifier' | 'structural' | 'doc' | 'config'>;
  reasons: string[];
  expandGraph: boolean;
}

// ============================================================================
// Search scope — what files/directories to search
// ============================================================================

export interface SearchScope {
  roots: string[];
  filePaths?: string[];
  includeTests: boolean;
}

// ============================================================================
// Candidates — search results before final ranking
// ============================================================================

export interface CodeCandidate {
  candidateType: 'declaration' | 'usage' | 'pattern' | 'doc' | 'config';

  filePath: string;
  line: number;
  column?: number;

  symbol?: string;
  enclosingSymbol?: string;
  enclosingKind?: string;
  matchedIdentifier?: string;

  kind?: 'function' | 'class' | 'method' | 'variable' | 'component' | 'file' | 'usage' | 'pattern' | 'config' | 'doc';
  signature?: string;
  snippet?: string;
  context?: string;

  score: number;
  confidence?: 'high' | 'medium' | 'low';
  evidence: string[];
  sources: Array<'behavior' | 'identifier' | 'structural' | 'doc' | 'config' | 'lsp' | 'graph'>;
}

/**
 * Deduplication key for candidates.
 * Uses match identity, not just symbol name.
 */
export function candidateKey(c: CodeCandidate): string {
  return `${c.candidateType}:${c.filePath}:${c.line}:${c.column ?? 0}:${c.matchedIdentifier ?? c.symbol ?? ''}`;
}

// ============================================================================
// Index types — workspace-level declaration and usage indexes
// ============================================================================

export interface DeclarationIndexEntry {
  symbol: string;
  kind: string;
  filePath: string;
  line: number;
  column: number;
  isExported: boolean;
  pathTokens: string[];
  symbolTokens: string[];
}

export interface UsageIndexEntry {
  identifier: string;
  normalizedIdentifier: string;
  kind: 'call' | 'member-call' | 'identifier' | 'import' | 'jsx-tag';
  filePath: string;
  line: number;
  column: number;
  enclosingSymbol?: string;
  enclosingKind?: string;
  pathTokens: string[];
}

export interface DocIndexEntry {
  filePath: string;
  line: number;
  kind: 'jsdoc' | 'comment' | 'test-title';
  text: string;
  tokens: string[];
  attachedSymbol?: string;
}

export interface ConfigIndexEntry {
  filePath: string;
  line: number;
  kind: 'json' | 'yaml' | 'env' | 'route' | 'package' | 'config';
  keyPath?: string[];
  text: string;
  tokens: string[];
}

export interface IndexedFile {
  filePath: string;
  mtimeMs: number;
  declarations: DeclarationIndexEntry[];
  usages: UsageIndexEntry[];
  docs: DocIndexEntry[];
}

export interface WorkspaceIndex {
  root: string;
  builtAt: number;
  files: Map<string, IndexedFile>;
  declarations: DeclarationIndexEntry[];
  usages: UsageIndexEntry[];
  docs: DocIndexEntry[];
  configs: ConfigIndexEntry[];
}

// ============================================================================
// Result types — final output from find_code
// ============================================================================

export interface FindCodeResult {
  query: string;
  ir: QueryIR;
  plan: SearchPlan;
  confidence: 'high' | 'medium' | 'low';
  candidates: CodeCandidate[];
  stats: {
    filesIndexed: number;
    declarationHits: number;
    usageHits: number;
    structuralHits: number;
    lspEnriched: number;
    elapsedMs: number;
    partialResult: boolean;
  };
  warnings: string[];
}

export interface PatternMatch {
  filePath: string;
  line: number;
  column?: number;
  text: string;
  context: string;
}


export interface FindPatternResult {
  pattern: string;
  language: 'typescript' | 'tsx' | 'javascript';
  filesScanned: number;
  matchCount: number;
  matches: PatternMatch[];
  warnings: string[];
}
