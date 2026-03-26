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
  retrievers: Array<'behavior' | 'identifier' | 'structural'>;
  reasons: string[];
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
  candidateType: 'declaration' | 'usage' | 'pattern';

  filePath: string;
  line: number;
  column?: number;

  symbol?: string;
  enclosingSymbol?: string;
  enclosingKind?: string;
  matchedIdentifier?: string;

  kind?: 'function' | 'class' | 'method' | 'variable' | 'component' | 'file' | 'usage' | 'pattern';
  signature?: string;
  snippet?: string;
  context?: string;

  score: number;
  confidence?: 'high' | 'medium' | 'low';
  evidence: string[];
  sources: Array<'behavior' | 'identifier' | 'structural' | 'lsp'>;
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

export interface IndexedFile {
  filePath: string;
  mtimeMs: number;
  declarations: DeclarationIndexEntry[];
  usages: UsageIndexEntry[];
}

export interface WorkspaceIndex {
  root: string;
  builtAt: number;
  files: Map<string, IndexedFile>;
  declarations: DeclarationIndexEntry[];
  usages: UsageIndexEntry[];
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

// ============================================================================
// Legacy compat — will be removed when old search pipeline is deleted
// ============================================================================

/** @deprecated Use CodeCandidate instead */
export interface BehaviorCandidate {
  symbol?: string;
  kind?: 'function' | 'class' | 'method' | 'variable' | 'component' | 'file';
  filePath: string;
  line: number;
  signature?: string;
  score: number;
  evidence: string[];
  sources: Array<'lexical' | 'ast' | 'lsp'>;
}

/** @deprecated Use QueryIR instead */
export interface NormalizedQuery {
  raw: string;
  tokens: string[];
  behaviorFamilies: string[];
  synonyms: string[];
}

/** @deprecated */
export interface SearchStats {
  lexicalCandidates: number;
  astFilesScanned: number;
  astMatches: number;
  enrichedCandidates: number;
}

/** @deprecated Use FindCodeResult instead */
export interface FindCodeByBehaviorResult {
  query: string;
  normalizedQuery: NormalizedQuery;
  stats: SearchStats;
  confidence: 'high' | 'medium' | 'low';
  candidates: BehaviorCandidate[];
}

/** @deprecated Use BehaviorFamily from families/behaviorFamilies.ts */
export interface BehaviorFamily {
  id: string;
  triggerTerms: string[];
  synonyms: string[];
  fileHints: string[];
  symbolHints: string[];
  astPatterns: string[];
  scoreBoosts: {
    pathHint: number;
    symbolHint: number;
    astMatch: number;
    exported: number;
  };
}

/** @deprecated Use DeclarationIndexEntry instead */
export interface LexicalEntry {
  symbol: string;
  kind: string;
  filePath: string;
  line: number;
  tokens: string[];
  isExported: boolean;
}

export interface FindPatternResult {
  pattern: string;
  language: 'typescript' | 'tsx' | 'javascript';
  filesScanned: number;
  matchCount: number;
  matches: PatternMatch[];
  warnings: string[];
}
