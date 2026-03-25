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

export interface NormalizedQuery {
  raw: string;
  tokens: string[];
  behaviorFamilies: string[];
  synonyms: string[];
}

export interface SearchStats {
  lexicalCandidates: number;
  astFilesScanned: number;
  astMatches: number;
  enrichedCandidates: number;
}

export interface FindCodeByBehaviorResult {
  query: string;
  normalizedQuery: NormalizedQuery;
  stats: SearchStats;
  confidence: 'high' | 'medium' | 'low';
  candidates: BehaviorCandidate[];
}

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

export interface LexicalEntry {
  symbol: string;
  kind: string;
  filePath: string;
  line: number;
  tokens: string[];
  isExported: boolean;
}
