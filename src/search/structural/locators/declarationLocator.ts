import ts from 'typescript';
import type { QueryIR, StructuralPredicate } from '../../types.js';
import type { StructuralLocator, LocatedNode } from './types.js';

const DECLARATION_PREDICATES: Set<StructuralPredicate> = new Set([
  'no-try-catch', 'returns-function',
]);

/**
 * Locates function/method declarations for structural filtering.
 * Best for: "async function without try/catch", declaration-shaped queries.
 */
export const declarationLocator: StructuralLocator = {
  kind: 'declaration',

  supports(predicates, ir) {
    // Only use when no identifiers and predicates apply to declarations
    if (ir.exactIdentifiers.length > 0) return false;
    return predicates.some((p) => DECLARATION_PREDICATES.has(p));
  },

  locate(sf, ir) {
    const nodes: LocatedNode[] = [];
    const isAsync = ir.codeTokens.includes('async');

    function visit(node: ts.Node) {
      if (ts.isFunctionDeclaration(node) && node.name && node.body) {
        // Filter to async if query mentions async
        if (isAsync && !node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) {
          ts.forEachChild(node, visit);
          return;
        }
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        nodes.push({ node, identifier: node.name.text, line });
      }

      // Arrow functions / function expressions assigned to variables
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const init = node.initializer;
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
          if (isAsync && !init.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) {
            ts.forEachChild(node, visit);
            return;
          }
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          nodes.push({ node: init, identifier: node.name.text, line });
        }
      }

      // Methods
      if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.body) {
        if (isAsync && !node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) {
          ts.forEachChild(node, visit);
          return;
        }
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        nodes.push({ node, identifier: node.name.text, line });
      }

      ts.forEachChild(node, visit);
    }

    visit(sf);
    return nodes;
  },
};
