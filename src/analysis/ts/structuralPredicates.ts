import ts from 'typescript';
import type { StructuralPredicate } from '../../search/types.js';
import { hasFunctionalStateUpdater } from './reactState.js';

/**
 * Evaluate structural predicates on a TS AST node.
 * Returns which predicates matched and evidence strings.
 */
export function evaluateStructuralPredicates(
  sf: ts.SourceFile,
  node: ts.Node,
  predicates: StructuralPredicate[],
): { matched: StructuralPredicate[]; evidence: string[] } {
  const matched: StructuralPredicate[] = [];
  const evidence: string[] = [];

  for (const pred of predicates) {
    const result = evaluatePredicate(sf, node, pred);
    if (result) {
      matched.push(pred);
      evidence.push(result);
    }
  }

  return { matched, evidence };
}

function evaluatePredicate(sf: ts.SourceFile, node: ts.Node, pred: StructuralPredicate): string | null {
  switch (pred) {
    case 'conditional':
      return hasConditional(node) ? 'contains conditional branch' : null;

    case 'returns-function':
      return returnsFunction(node) ? 'returns a function expression' : null;

    case 'returns-cleanup':
      return returnsCleanup(node) ? 'callback returns a cleanup function' : null;

    case 'no-cleanup':
      return !returnsCleanup(node) && isCallbackLike(node) ? 'callback does not return cleanup' : null;

    case 'has-try-catch':
      return containsTryCatch(node) ? 'contains try-catch block' : null;

    case 'no-try-catch':
      return !containsTryCatch(node) ? 'no try-catch in scope' : null;

    case 'switch-no-default':
      return hasSwitchWithoutDefault(node) ? 'switch statement missing default case' : null;

    case 'await-in-loop':
      return hasAwaitInLoop(node) ? 'await inside loop body' : null;

    case 'inside-hook':
      return isInsideHookCall(node) ? 'inside a React hook call' : null;

    case 'hook-callback':
      return isHookCallback(node) ? 'is a callback argument to a hook' : null;

    case 'functional-state-updater':
      return hasFunctionalStateUpdater(node) ? 'contains functional state updater (e.g. setState(prev => ...))' : null;

    default:
      return null;
  }
}

// --- Predicate implementations ---

function hasConditional(node: ts.Node): boolean {
  let found = false;
  function walk(n: ts.Node) {
    if (found) return;
    if (ts.isIfStatement(n) || ts.isConditionalExpression(n) || ts.isSwitchStatement(n)) {
      found = true;
      return;
    }
    ts.forEachChild(n, walk);
  }
  ts.forEachChild(node, walk);
  return found;
}

function returnsFunction(node: ts.Node): boolean {
  let found = false;
  function walk(n: ts.Node) {
    if (found) return;
    if (ts.isReturnStatement(n) && n.expression) {
      if (ts.isArrowFunction(n.expression) || ts.isFunctionExpression(n.expression)) {
        found = true;
        return;
      }
    }
    ts.forEachChild(n, walk);
  }
  ts.forEachChild(node, walk);
  return found;
}

function returnsCleanup(node: ts.Node): boolean {
  // For hook callbacks: check if the callback body returns a function
  const callback = getFirstCallbackArg(node);
  if (!callback) return returnsFunction(node);
  return returnsFunction(callback);
}

function isCallbackLike(node: ts.Node): boolean {
  return getFirstCallbackArg(node) !== null;
}

function containsTryCatch(node: ts.Node): boolean {
  let found = false;
  function walk(n: ts.Node) {
    if (found) return;
    if (ts.isTryStatement(n)) { found = true; return; }
    ts.forEachChild(n, walk);
  }
  ts.forEachChild(node, walk);
  return found;
}

function hasSwitchWithoutDefault(node: ts.Node): boolean {
  let found = false;
  function walk(n: ts.Node) {
    if (found) return;
    if (ts.isSwitchStatement(n)) {
      const hasDefault = n.caseBlock.clauses.some((c) => ts.isDefaultClause(c));
      if (!hasDefault) { found = true; return; }
    }
    ts.forEachChild(n, walk);
  }
  ts.forEachChild(node, walk);
  return found;
}

function hasAwaitInLoop(node: ts.Node): boolean {
  let insideLoop = false;
  let found = false;
  function walk(n: ts.Node) {
    if (found) return;
    const wasInsideLoop = insideLoop;
    if (ts.isForStatement(n) || ts.isForOfStatement(n) || ts.isForInStatement(n) || ts.isWhileStatement(n) || ts.isDoStatement(n)) {
      insideLoop = true;
    }
    if (insideLoop && ts.isAwaitExpression(n)) { found = true; return; }
    ts.forEachChild(n, walk);
    insideLoop = wasInsideLoop;
  }
  ts.forEachChild(node, walk);
  return found;
}

function isInsideHookCall(node: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isCallExpression(current) && ts.isIdentifier(current.expression)) {
      if (isHookName(current.expression.text)) return true;
    }
    current = current.parent;
  }
  return false;
}

function isHookCallback(node: ts.Node): boolean {
  // Check if this node is a call expression where the callee is a hook
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    return isHookName(node.expression.text);
  }
  return false;
}

function isHookName(name: string): boolean {
  return /^use[A-Z]/.test(name);
}

/**
 * Get the first callback argument from a call expression.
 * For useEffect(callback, deps), returns the callback.
 */
function getFirstCallbackArg(node: ts.Node): ts.Node | null {
  if (ts.isCallExpression(node) && node.arguments.length > 0) {
    const first = node.arguments[0];
    if (ts.isArrowFunction(first) || ts.isFunctionExpression(first)) {
      return first;
    }
  }
  return null;
}
