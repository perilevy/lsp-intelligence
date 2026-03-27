import type { QueryIR, SearchScope, WorkspaceIndex, CodeCandidate } from '../types.js';
import { parseSourceFile } from '../../analysis/ts/parseSourceFile.js';
import { evaluateStructuralPredicates } from '../../analysis/ts/structuralPredicates.js';
import { buildSnippetFromFile } from '../../analysis/ts/snippets.js';
import { selectLocators } from '../structural/selectLocators.js';
import ts from 'typescript';

/**
 * Retrieve candidates using structural predicate evaluation.
 *
 * Uses the locator system to find candidate nodes:
 * - callLocator: call expressions (useEffect, Promise.all, etc.)
 * - statementLocator: switch, try/catch, loops with await
 * - declarationLocator: function/method declarations
 *
 * Then evaluates structural predicates on each located node.
 */
export function retrieveStructuralCandidates(
  ir: QueryIR,
  scope: SearchScope,
  index: WorkspaceIndex,
): CodeCandidate[] {
  if (ir.structuralPredicates.length === 0) return [];

  const candidates: CodeCandidate[] = [];
  const maxFiles = 80;
  let filesChecked = 0;
  const locators = selectLocators(ir);

  if (locators.length === 0) return [];

  // Determine which files to check
  const targetFiles = new Set<string>();

  if (ir.exactIdentifiers.length > 0 || ir.dottedIdentifiers.length > 0) {
    // If we have identifiers, only check files with matching usages
    const allIds = [...ir.exactIdentifiers, ...ir.dottedIdentifiers];
    for (const usage of index.usages) {
      if (allIds.some((id) => usage.identifier === id || usage.normalizedIdentifier === id)) {
        targetFiles.add(usage.filePath);
      }
    }
  } else {
    // No specific identifier — check indexed files (capped)
    for (const file of index.files.keys()) {
      targetFiles.add(file);
      if (targetFiles.size >= maxFiles) break;
    }
  }

  // For each file, run all selected locators and evaluate predicates
  for (const filePath of targetFiles) {
    if (filesChecked >= maxFiles) break;
    filesChecked++;

    const sf = parseSourceFile(filePath);
    if (!sf) continue;

    for (const locator of locators) {
      const nodes = locator.locate(sf, ir);

      for (const { node, identifier, line } of nodes) {
        const { matched, evidence } = evaluateStructuralPredicates(sf, node, ir.structuralPredicates);

        if (matched.length === 0) continue;

        const score = matched.length * 5 + (matched.length === ir.structuralPredicates.length ? 5 : 0);
        const { snippet, context } = buildSnippetFromFile(filePath, line, 2);
        const enclosing = findEnclosingDeclaration(node);

        candidates.push({
          candidateType: 'usage',
          filePath,
          line,
          column: sf.getLineAndCharacterOfPosition(node.getStart(sf)).character,
          matchedIdentifier: identifier,
          enclosingSymbol: enclosing?.name,
          enclosingKind: enclosing?.kind,
          kind: 'usage',
          snippet,
          context,
          score,
          evidence: [
            `structural-match: ${matched.join(', ')}`,
            `predicates: ${matched.length}/${ir.structuralPredicates.length}`,
            `locator: ${locator.kind}`,
            ...evidence,
          ],
          sources: ['structural'],
        });
      }
    }
  }

  return candidates.sort((a, b) => b.score - a.score);
}

function findEnclosingDeclaration(node: ts.Node): { name: string; kind: string } | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isFunctionDeclaration(current) && current.name) {
      return { name: current.name.text, kind: 'function' };
    }
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
      return { name: current.name.text, kind: 'variable' };
    }
    if (ts.isMethodDeclaration(current) && ts.isIdentifier(current.name)) {
      return { name: current.name.text, kind: 'method' };
    }
    if (ts.isClassDeclaration(current) && current.name) {
      return { name: current.name.text, kind: 'class' };
    }
    current = current.parent;
  }
  return undefined;
}
