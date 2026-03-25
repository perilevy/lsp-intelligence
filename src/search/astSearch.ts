import * as fs from 'fs';
import * as path from 'path';
import { parse, Lang } from '@ast-grep/napi';
import { BEHAVIOR_FAMILIES } from './behaviorFamilies.js';
import type { BehaviorCandidate, NormalizedQuery } from './types.js';
import { relativePath } from '../engine/positions.js';
import { SKIP_DIRS } from '../engine/types.js';

/**
 * Build a shortlist of files to AST-scan based on query and lexical candidates.
 */
export function buildAstShortlist(
  workspaceRoot: string,
  query: NormalizedQuery,
  lexicalCandidates: BehaviorCandidate[],
  maxFiles: number,
): string[] {
  const files = new Set<string>();
  const matchedFamilies = BEHAVIOR_FAMILIES.filter((f) => query.behaviorFamilies.includes(f.id));

  // Priority 1: files whose names/paths match behavior family hints
  const allFileHints = matchedFamilies.flatMap((f) => f.fileHints);
  if (allFileHints.length > 0) {
    const walk = (dir: string, depth: number) => {
      if (depth > 6 || files.size >= maxFiles) return;
      try {
        for (const entry of fs.readdirSync(dir)) {
          if (SKIP_DIRS.has(entry)) continue;
          const full = path.join(dir, entry);
          const stat = fs.statSync(full);
          if (stat.isDirectory()) {
            walk(full, depth + 1);
          } else if ((entry.endsWith('.ts') || entry.endsWith('.tsx')) && !entry.endsWith('.d.ts')) {
            const lower = entry.toLowerCase();
            if (allFileHints.some((h) => lower.includes(h))) {
              files.add(full);
            }
          }
        }
      } catch {}
    };
    walk(workspaceRoot, 0);
  }

  // Priority 2: files that contain top lexical candidates
  for (const candidate of lexicalCandidates.slice(0, 30)) {
    if (files.size >= maxFiles) break;
    files.add(candidate.filePath);
  }

  return [...files].slice(0, maxFiles);
}

/**
 * Run AST patterns from matched behavior families against shortlisted files.
 * Returns AST-boosted candidates.
 */
export function astSearch(
  shortlist: string[],
  query: NormalizedQuery,
  workspaceRoot: string,
): { candidates: BehaviorCandidate[]; filesScanned: number; matchCount: number } {
  const matchedFamilies = BEHAVIOR_FAMILIES.filter((f) => query.behaviorFamilies.includes(f.id));
  const candidates: BehaviorCandidate[] = [];
  let matchCount = 0;

  if (matchedFamilies.length === 0) {
    return { candidates: [], filesScanned: 0, matchCount: 0 };
  }

  // Collect all AST patterns with their family boosts
  const patternGroups = matchedFamilies.map((family) => ({
    familyId: family.id,
    patterns: family.astPatterns,
    boost: family.scoreBoosts.astMatch,
  }));

  for (const filePath of shortlist) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const isTsx = filePath.endsWith('.tsx');
      const lang = isTsx ? Lang.Tsx : Lang.TypeScript;
      const root = parse(lang, content).root();

      for (const group of patternGroups) {
        for (const pattern of group.patterns) {
          try {
            const matches = root.findAll(pattern);
            for (const match of matches) {
              matchCount++;
              const range = match.range();
              const line = range.start.line + 1;
              // Try to extract the function/symbol name from the match
              const nameNode = match.getMatch('F') ?? match.getMatch('NAME');
              const symbolName = nameNode?.text() ?? extractNearestSymbol(content, range.start.line);

              candidates.push({
                symbol: symbolName,
                kind: 'function',
                filePath,
                line,
                score: group.boost,
                evidence: [`ast-pattern-match: ${group.familyId}`],
                sources: ['ast'],
              });
            }
          } catch {
            // Pattern may not be valid for this file — skip
          }
        }
      }
    } catch {}
  }

  return { candidates, filesScanned: shortlist.length, matchCount };
}

/**
 * Try to extract the nearest function/class name from a line.
 */
function extractNearestSymbol(content: string, line0: number): string | undefined {
  const lines = content.split('\n');
  // Look backward up to 5 lines for a declaration
  for (let i = line0; i >= Math.max(0, line0 - 5); i--) {
    const match = lines[i]?.match(/(?:function|const|class|interface|type)\s+(\w+)/);
    if (match) return match[1];
  }
  return undefined;
}
