import type { QueryIR, SearchScope, WorkspaceIndex, CodeCandidate } from '../types.js';
import { parseSourceFile } from '../../analysis/ts/parseSourceFile.js';
import { evaluateStructuralPredicates } from '../../analysis/ts/structuralPredicates.js';
import { buildSnippetFromFile } from '../../analysis/ts/snippets.js';
import ts from 'typescript';

/**
 * Retrieve candidates using structural predicate evaluation.
 *
 * Two-step design:
 * Step 1: Locate candidate nodes (prefer usage sites of exact identifiers)
 * Step 2: Evaluate structural predicates on each candidate node
 *
 * This is NOT recipe-only string patterns — it uses TS AST node evaluation.
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

  // Step 1: Determine which files to check
  // If we have exact identifiers, only check files with matching usages
  const targetFiles = new Set<string>();

  if (ir.exactIdentifiers.length > 0 || ir.dottedIdentifiers.length > 0) {
    const allIds = [...ir.exactIdentifiers, ...ir.dottedIdentifiers];
    for (const usage of index.usages) {
      if (allIds.some((id) => usage.identifier === id || usage.normalizedIdentifier === id)) {
        targetFiles.add(usage.filePath);
      }
    }
  } else {
    // No specific identifier — check files from behavior or all indexed files (capped)
    for (const file of index.files.keys()) {
      targetFiles.add(file);
      if (targetFiles.size >= maxFiles) break;
    }
  }

  // Step 2: For each target file, find nodes and evaluate predicates
  for (const filePath of targetFiles) {
    if (filesChecked >= maxFiles) break;
    filesChecked++;

    const sf = parseSourceFile(filePath);
    if (!sf) continue;

    // Find candidate nodes: call expressions matching our identifiers
    const allIds = [...ir.exactIdentifiers, ...ir.dottedIdentifiers];
    const nodes = findTargetCallNodes(sf, allIds);

    for (const { node, identifier, line } of nodes) {
      const { matched, evidence } = evaluateStructuralPredicates(sf, node, ir.structuralPredicates);

      if (matched.length === 0) continue;

      const score = matched.length * 5 + (matched.length === ir.structuralPredicates.length ? 5 : 0);
      const { snippet, context } = buildSnippetFromFile(filePath, line, 2);

      // Find enclosing function/component name
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
          ...evidence,
        ],
        sources: ['structural'],
      });
    }
  }

  return candidates.sort((a, b) => b.score - a.score);
}

interface TargetNode {
  node: ts.Node;
  identifier: string;
  line: number;
}

/**
 * Find call expression nodes that match the target identifiers.
 * For queries without identifiers, returns all top-level call expressions.
 */
function findTargetCallNodes(sf: ts.SourceFile, identifiers: string[]): TargetNode[] {
  const nodes: TargetNode[] = [];

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      let name: string | null = null;

      if (ts.isIdentifier(expr)) {
        name = expr.text;
      } else if (ts.isPropertyAccessExpression(expr)) {
        name = getFullPropertyAccess(expr);
      }

      if (name) {
        const matches = identifiers.length === 0 ||
          identifiers.some((id) => name === id || name!.endsWith(`.${id}`));

        if (matches) {
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          nodes.push({ node, identifier: name, line });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);
  return nodes;
}

function getFullPropertyAccess(node: ts.PropertyAccessExpression): string {
  const parts: string[] = [node.name.text];
  let current: ts.Expression = node.expression;
  while (ts.isPropertyAccessExpression(current)) {
    parts.unshift(current.name.text);
    current = current.expression;
  }
  if (ts.isIdentifier(current)) parts.unshift(current.text);
  return parts.join('.');
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
