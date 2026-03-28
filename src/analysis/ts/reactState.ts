import ts from 'typescript';

/**
 * Detect if a node contains a functional state updater pattern.
 * Matches: setState(prev => ...), setCount(current => current + 1), etc.
 *
 * Only matches when the updater parameter is actually used in the body.
 * Does NOT match: setState(() => 1) — that's a constant updater.
 */
export function hasFunctionalStateUpdater(node: ts.Node): boolean {
  let found = false;

  function walk(n: ts.Node) {
    if (found) return;

    // Look for calls like setFoo(param => ...)
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const callee = n.expression.text;
      // Must start with "set" and have PascalCase after (setState, setCount, setItems)
      if (/^set[A-Z]/.test(callee) && n.arguments.length >= 1) {
        const arg = n.arguments[0];
        if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
          // Must have exactly one parameter
          if (arg.parameters.length === 1) {
            const paramName = arg.parameters[0].name;
            if (ts.isIdentifier(paramName)) {
              // Check if the parameter is actually used in the body
              if (isIdentifierUsedInBody(paramName.text, arg.body)) {
                found = true;
                return;
              }
            }
          }
        }
      }
    }

    ts.forEachChild(n, walk);
  }

  walk(node);
  return found;
}

function isIdentifierUsedInBody(name: string, body: ts.Node): boolean {
  let used = false;
  function walk(n: ts.Node) {
    if (used) return;
    if (ts.isIdentifier(n) && n.text === name) {
      // Make sure it's not the parameter declaration itself
      if (!ts.isParameter(n.parent)) {
        used = true;
        return;
      }
    }
    ts.forEachChild(n, walk);
  }
  walk(body);
  return used;
}
