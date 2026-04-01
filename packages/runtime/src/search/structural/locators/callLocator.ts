import ts from 'typescript';
import type { QueryIR, StructuralPredicate } from '../../types.js';
import type { StructuralLocator, LocatedNode } from './types.js';

const CALL_PREDICATES: Set<StructuralPredicate> = new Set([
  'returns-cleanup', 'no-cleanup', 'returns-function',
  'hook-callback', 'inside-hook', 'conditional',
]);

/**
 * Locates call expression nodes — the original structural retriever path.
 * Best for: useEffect, Promise.all, hook/API usage shapes.
 */
export const callLocator: StructuralLocator = {
  kind: 'call',

  supports(predicates, ir) {
    // Supports if we have identifiers to match, or call-centric predicates
    if (ir.exactIdentifiers.length > 0 || ir.dottedIdentifiers.length > 0) return true;
    return predicates.some((p) => CALL_PREDICATES.has(p));
  },

  locate(sf, ir) {
    const nodes: LocatedNode[] = [];
    const allIds = [...ir.exactIdentifiers, ...ir.dottedIdentifiers];

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
          const matches = allIds.length === 0 ||
            allIds.some((id) => name === id || name!.endsWith(`.${id}`));
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
  },
};

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
