import ts from 'typescript';
import type { QueryIR, StructuralPredicate } from '../../types.js';
import type { StructuralLocator, LocatedNode } from './types.js';

const STATEMENT_PREDICATES: Set<StructuralPredicate> = new Set([
  'switch-no-default', 'has-try-catch', 'no-try-catch', 'await-in-loop',
]);

/**
 * Locates statement-level nodes — switch, try/catch, loops with await.
 * Best for: "switch without default", "await inside loop", "async without try/catch".
 */
export const statementLocator: StructuralLocator = {
  kind: 'statement',

  supports(predicates) {
    return predicates.some((p) => STATEMENT_PREDICATES.has(p));
  },

  locate(sf, ir) {
    const nodes: LocatedNode[] = [];
    const targetPredicates = ir.structuralPredicates.filter((p) => STATEMENT_PREDICATES.has(p));

    function visit(node: ts.Node) {
      // Switch statements
      if (ts.isSwitchStatement(node) && targetPredicates.includes('switch-no-default')) {
        const hasDefault = node.caseBlock.clauses.some((c) => ts.isDefaultClause(c));
        if (!hasDefault) {
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          nodes.push({ node, identifier: 'switch', line });
        }
      }

      // Try statements
      if (ts.isTryStatement(node) && targetPredicates.includes('has-try-catch')) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        nodes.push({ node, identifier: 'try-catch', line });
      }

      // Loops with await
      if (isLoopStatement(node) && targetPredicates.includes('await-in-loop')) {
        if (containsAwait(node)) {
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          nodes.push({ node, identifier: 'await-in-loop', line });
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sf);
    return nodes;
  },
};

function isLoopStatement(node: ts.Node): boolean {
  return ts.isForStatement(node) || ts.isForOfStatement(node) ||
    ts.isForInStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node);
}

function containsAwait(node: ts.Node): boolean {
  let found = false;
  function walk(n: ts.Node) {
    if (found) return;
    if (ts.isAwaitExpression(n)) { found = true; return; }
    // Don't descend into nested functions
    if (ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n)) return;
    ts.forEachChild(n, walk);
  }
  ts.forEachChild(node, walk);
  return found;
}
