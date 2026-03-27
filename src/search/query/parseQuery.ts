import type { QueryIR, QueryTraits, StructuralPredicate, SearchPlan } from '../types.js';
import { scoreFamilies } from '../families/behaviorFamilies.js';

// Short family names (from find_code schema) → real family IDs
const FAMILY_ALIASES: Record<string, string> = {
  auth: 'auth_permission',
  errors: 'error_handling',
  state: 'state_management',
  flags: 'feature_flags',
  retry: 'retry_backoff',
  validation: 'validation',
  fetching: 'fetching',
  caching: 'caching',
};

// Structural cue words — preserved, NOT removed as stop words
const STRUCTURAL_CUES = new Set([
  'conditional', 'conditionally', 'if', 'return', 'returns', 'cleanup',
  'callback', 'without', 'inside', 'nested', 'loop', 'async', 'await',
  'try', 'catch', 'switch', 'default', 'throw', 'promise',
]);

// NL stop words — only removed from the NL channel
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'where', 'how', 'what', 'which', 'who', 'when', 'why',
  'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
  'some', 'such', 'no', 'not', 'only', 'own', 'same', 'so', 'than',
  'too', 'very', 'just', 'we', 'they', 'i', 'my', 'our', 'that',
  'this', 'these', 'those', 'me', 'him', 'her', 'it', 'its',
]);

// Identifier pattern: camelCase, PascalCase, dotted (Promise.all, React.useEffect)
const IDENTIFIER_PATTERN = /\b([A-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)*|[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)*)\b/g;

// Hook name pattern
const HOOK_PATTERN = /^use[A-Z]/;

// Structural predicate mapping from cue words
const PREDICATE_MAP: Record<string, StructuralPredicate[]> = {
  conditional: ['conditional'],
  conditionally: ['conditional'],
  if: ['conditional'],
  return: [],   // phrase-based: only fires in combination (returns + cleanup, etc.)
  returns: [],   // phrase-based: only fires in combination
  cleanup: [],   // phrase-based: returns + cleanup → returns-cleanup
  callback: [],  // phrase-based: callback + hook identifier → hook-callback
  try: ['has-try-catch'],
  catch: ['has-try-catch'],
  without: [], // modifier — inverts next predicate
  loop: ['await-in-loop'],
  switch: ['switch-no-default'],
  default: ['switch-no-default'],
  hook: ['inside-hook'],
  nested: [],
  async: [],
  await: ['await-in-loop'],
  promise: [],
  throw: [],
};

/**
 * Parse a raw query string into a structured QueryIR.
 * Extracts three channels: NL tokens, exact identifiers, structural cues.
 */
export function parseQuery(
  raw: string,
  opts?: {
    forcedMode?: SearchPlan['mode'] | 'auto';
    forcedFamily?: string;
  },
): QueryIR {
  const words = raw.split(/\s+/).filter(Boolean);

  // --- Channel 1: Exact identifiers ---
  const exactIdentifiers: string[] = [];
  const dottedIdentifiers: string[] = [];

  for (const word of words) {
    const clean = word.replace(/[^a-zA-Z0-9.]/g, '');
    if (!clean) continue;

    // Dotted identifier: Promise.all, React.useEffect
    if (clean.includes('.') && /^[A-Za-z]/.test(clean)) {
      dottedIdentifiers.push(clean);
      continue;
    }

    // CamelCase/PascalCase identifier (not a plain lowercase word)
    if (/^[A-Z]/.test(clean) || (HOOK_PATTERN.test(clean)) || (/[a-z][A-Z]/.test(clean) && clean.length > 3)) {
      exactIdentifiers.push(clean);
    }
  }

  // --- Channel 2: Structural cues ---
  const structuralPredicates: StructuralPredicate[] = [];
  const codeTokens: string[] = [];
  const hasWithout = words.some((w) => w.toLowerCase() === 'without');

  for (const word of words) {
    const lower = word.toLowerCase().replace(/[^a-z]/g, '');
    if (STRUCTURAL_CUES.has(lower)) {
      codeTokens.push(lower);
      const preds = PREDICATE_MAP[lower] ?? [];
      for (const pred of preds) {
        // Handle "without" modifier
        if (hasWithout && pred === 'returns-cleanup') {
          if (!structuralPredicates.includes('no-cleanup')) structuralPredicates.push('no-cleanup');
        } else if (hasWithout && pred === 'has-try-catch') {
          if (!structuralPredicates.includes('no-try-catch')) structuralPredicates.push('no-try-catch');
        } else {
          if (!structuralPredicates.includes(pred)) structuralPredicates.push(pred);
        }
      }
    }
  }

  // Phrase-based structural inference — requires combinations, not isolated keywords.
  // This prevents "returns" alone from implying returns-function.
  const hasHookId = exactIdentifiers.some((id) => HOOK_PATTERN.test(id));

  if (codeTokens.includes('cleanup')) {
    if (codeTokens.includes('returns') || codeTokens.includes('return')) {
      // "returns cleanup" or "return cleanup"
      if (hasWithout) {
        if (!structuralPredicates.includes('no-cleanup')) structuralPredicates.push('no-cleanup');
      } else {
        if (!structuralPredicates.includes('returns-cleanup')) structuralPredicates.push('returns-cleanup');
      }
    } else if (hasWithout) {
      // "without cleanup" (no returns keyword needed)
      if (!structuralPredicates.includes('no-cleanup')) structuralPredicates.push('no-cleanup');
    }
  }

  if (codeTokens.includes('returns') || codeTokens.includes('return')) {
    if (codeTokens.includes('callback') || hasHookId) {
      // "returns callback" or "useEffect ... returns"
      if (!structuralPredicates.includes('returns-function')) structuralPredicates.push('returns-function');
    }
  }

  if (codeTokens.includes('callback') && hasHookId) {
    // "useEffect callback" — hook + callback together
    if (!structuralPredicates.includes('hook-callback')) structuralPredicates.push('hook-callback');
  }

  // Hook identifier + any structural predicates → add hook-callback context
  if (hasHookId && structuralPredicates.length > 0) {
    if (!structuralPredicates.includes('hook-callback')) {
      structuralPredicates.push('hook-callback');
    }
  }

  // --- Channel 3: NL tokens ---
  const nlTokens: string[] = [];
  for (const word of words) {
    const lower = word.toLowerCase().replace(/[^a-z]/g, '');
    if (!lower || lower.length < 2) continue;
    if (STOP_WORDS.has(lower)) continue;
    // Don't add exact identifiers to NL channel
    if (exactIdentifiers.includes(word) || dottedIdentifiers.includes(word)) continue;
    nlTokens.push(lower);
  }

  // --- Phrases ---
  const phrases = extractPhrases(raw);

  // --- Family scoring ---
  const allTerms = [...nlTokens, ...codeTokens];
  let familyScores = scoreFamilies(allTerms);

  // Apply forced family (resolve short alias → real ID)
  if (opts?.forcedFamily) {
    const resolvedFamily = FAMILY_ALIASES[opts.forcedFamily] ?? opts.forcedFamily;
    familyScores[resolvedFamily] = (familyScores[resolvedFamily] ?? 0) + 10;
  }

  // --- Mode routing ---
  const identifierScore = exactIdentifiers.length * 3 + dottedIdentifiers.length * 3;
  const structuralScore = structuralPredicates.length * 2 + codeTokens.length;
  const behaviorScore = Object.values(familyScores).reduce((s, v) => s + v, 0);

  let mode: QueryIR['mode'];
  let modeConfidence: QueryIR['modeConfidence'];
  const routingReasons: string[] = [];

  if (opts?.forcedMode && opts.forcedMode !== 'auto') {
    mode = opts.forcedMode;
    modeConfidence = 'high';
    routingReasons.push(`forced mode: ${mode}`);
  } else {
    // Determine mode from scores
    const hasIdentifiers = identifierScore > 0;
    const hasStructural = structuralScore > 2;
    const hasBehavior = behaviorScore > 2;

    if (hasIdentifiers && hasStructural) {
      mode = 'structural'; // identifier + structural = structural (use identifier to locate, predicates to filter)
      modeConfidence = 'high';
      routingReasons.push('exact identifier detected', 'structural cues detected');
    } else if (hasIdentifiers && !hasBehavior) {
      mode = 'identifier';
      modeConfidence = 'high';
      routingReasons.push('exact identifier detected', 'no strong behavior-family evidence');
    } else if (hasBehavior && hasStructural) {
      mode = 'mixed';
      modeConfidence = 'medium';
      routingReasons.push('behavior family matched', 'structural cues detected');
    } else if (hasBehavior) {
      mode = 'behavior';
      modeConfidence = behaviorScore > 5 ? 'high' : 'medium';
      routingReasons.push('behavior family matched');
    } else if (hasStructural) {
      mode = 'structural';
      modeConfidence = 'medium';
      routingReasons.push('structural cues detected');
    } else if (hasIdentifiers) {
      mode = 'identifier';
      modeConfidence = 'medium';
      routingReasons.push('identifier detected');
    } else {
      mode = 'behavior'; // fallback
      modeConfidence = 'low';
      routingReasons.push('no strong signals, defaulting to behavior');
    }
  }

  // --- Traits ---
  const allLower = raw.toLowerCase();
  const traits: QueryTraits = {
    routeLike: /\b(route|endpoint|url|path|api|handler)\b/.test(allLower),
    configLike: /\b(config|env|flag|toggle|setting|variable|secret)\b/.test(allLower),
    implementationRoot: /\b(real|actual|root|implementation|where.*(handled|defined|implemented))\b/.test(allLower),
    testIntent: /\b(test|spec|describe|it\s+should)\b/.test(allLower),
  };

  return {
    raw,
    nlTokens,
    phrases,
    exactIdentifiers,
    dottedIdentifiers,
    codeTokens,
    familyScores,
    structuralPredicates,
    traits,
    mode,
    modeConfidence,
    routingReasons,
  };
}

function extractPhrases(raw: string): string[] {
  // Extract 2-3 word phrases that might be meaningful
  const words = raw.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const phrases: string[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    phrases.push(`${words[i]} ${words[i + 1]}`);
  }
  return phrases;
}
