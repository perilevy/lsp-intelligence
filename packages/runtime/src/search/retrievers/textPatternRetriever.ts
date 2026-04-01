import * as fs from 'fs';
import type { QueryIR, SearchScope, WorkspaceIndex, CodeCandidate, RegExpSpec } from '../types.js';
import type { EffectiveSearchSpec } from '../query/compileEffectiveSearchSpec.js';
import { buildSnippetFromFile } from '../../analysis/ts/snippets.js';

/**
 * Retrieve candidates by running compiled regex specs over scoped files.
 * Uses the compiled spec's merged regexes (from all adapter recipes).
 */
export function retrieveTextPatternCandidates(
  ir: QueryIR,
  scope: SearchScope,
  index: WorkspaceIndex,
  spec?: EffectiveSearchSpec,
): CodeCandidate[] {
  // Use compiled spec regexes if available, otherwise collect from raw recipes
  const regexSpecs: RegExpSpec[] = spec?.regexes ?? [];
  if (regexSpecs.length === 0) {
    for (const recipe of ir.recipes) {
      if (recipe.regexes) regexSpecs.push(...recipe.regexes);
    }
  }

  if (regexSpecs.length === 0) return [];

  const compiled = regexSpecs.map((spec) => ({
    spec,
    regex: new RegExp(spec.pattern, spec.flags ?? 'g'),
  }));

  const candidates: CodeCandidate[] = [];
  const maxFiles = 200;
  let filesChecked = 0;

  for (const [filePath] of index.files) {
    if (filesChecked >= maxFiles) break;
    filesChecked++;

    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const lines = content.split('\n');

    for (const { spec, regex } of compiled) {
      // Reset regex state
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = regex.exec(content)) !== null) {
        // Find the line number of this match
        let charCount = 0;
        let lineNum = 1;
        for (let i = 0; i < lines.length; i++) {
          charCount += lines[i].length + 1; // +1 for newline
          if (charCount > match.index) {
            lineNum = i + 1;
            break;
          }
        }

        const { snippet, context } = buildSnippetFromFile(filePath, lineNum, 1);
        const enclosing = findEnclosingFunctionName(lines, lineNum - 1);

        candidates.push({
          candidateType: 'pattern',
          filePath,
          line: lineNum,
          symbol: enclosing,
          matchedIdentifier: spec.id,
          kind: 'pattern',
          snippet,
          context,
          score: 6, // Base score for regex match
          evidence: [`regex-match: ${spec.id}`, `pattern: ${spec.pattern.substring(0, 60)}`],
          sources: ['identifier'], // Counts as identifier-like evidence
        });

        // Limit matches per file
        if (candidates.length > 500) break;
      }
    }
  }

  return candidates.sort((a, b) => b.score - a.score);
}

/** Simple heuristic to find enclosing function name by scanning backwards. */
function findEnclosingFunctionName(lines: string[], fromLine: number): string | undefined {
  for (let i = fromLine; i >= Math.max(0, fromLine - 15); i--) {
    const line = lines[i];
    // function foo(
    const funcMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
    if (funcMatch) return funcMatch[1];
    // const foo = (
    const arrowMatch = line.match(/(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=/);
    if (arrowMatch && (line.includes('=>') || line.includes('function'))) return arrowMatch[1];
  }
  return undefined;
}
