import ts from 'typescript';
import type { CodeCandidate } from '../types.js';
import type { LspEngine } from '../../engine/LspEngine.js';
import { parseSourceFile } from '../../analysis/ts/parseSourceFile.js';
import { relativePath } from '../../engine/positions.js';

export interface GraphExpansionResult {
  promoted: Map<string, { scoreDelta: number; evidence: string[] }>;
  derived: CodeCandidate[];
  warnings: string[];
}

/**
 * Expand top candidates toward implementation roots.
 * Detects wrappers, follows definitions, and promotes likely real implementations.
 *
 * A function is a probable wrapper if:
 * - Body is short (< 5 statements)
 * - Contains one main call or return of another call
 * - Mostly forwards arguments
 */
export async function expandToImplementationRoots(
  candidates: CodeCandidate[],
  engine: LspEngine,
  maxSeeds: number = 5,
): Promise<GraphExpansionResult> {
  const promoted = new Map<string, { scoreDelta: number; evidence: string[] }>();
  const derived: CodeCandidate[] = [];
  const warnings: string[] = [];

  const seeds = candidates.slice(0, maxSeeds);

  for (const candidate of seeds) {
    try {
      const wrapperInfo = detectWrapper(candidate.filePath, candidate.line);
      if (!wrapperInfo) continue;

      // This candidate looks like a wrapper — try to find what it wraps
      const key = `${candidate.filePath}:${candidate.line}`;
      promoted.set(key, {
        scoreDelta: -2, // Demote wrappers
        evidence: [`wrapper-of: ${wrapperInfo.callTarget}`, `body-size: ${wrapperInfo.bodySize}`],
      });

      // Try to resolve the wrapped function via LSP
      try {
        const loc = await engine.resolveSymbol(wrapperInfo.callTarget);
        if (loc) {
          // Convert URI to relative path + 1-based line to match candidate keys
          const filePath = relativePath(
            loc.uri.startsWith('file://') ? decodeURIComponent(loc.uri.replace('file://', '')) : loc.uri,
            engine.workspaceRoot,
          );
          const line1 = loc.position.line + 1; // LSP is 0-based, candidates are 1-based
          const derivedKey = `${filePath}:${line1}`;
          if (!promoted.has(derivedKey)) {
            promoted.set(derivedKey, {
              scoreDelta: 4, // Promote implementation roots
              evidence: ['implementation-root', `wrapped-by: ${candidate.symbol ?? 'unknown'}`],
            });
          }
        }
      } catch {
        // LSP resolution failed — skip this expansion
      }
    } catch (err: any) {
      warnings.push(`graph-expand failed for ${candidate.symbol}: ${err?.message ?? 'unknown'}`);
    }
  }

  return { promoted, derived, warnings };
}

interface WrapperInfo {
  callTarget: string;
  bodySize: number;
}

/**
 * Detect if a function at the given location is a probable wrapper.
 * Uses local AST analysis only — no LSP calls.
 */
function detectWrapper(filePath: string, line: number): WrapperInfo | null {
  const sf = parseSourceFile(filePath);
  if (!sf) return null;

  // Find the function declaration at or near the given line
  const targetLine = line - 1; // 0-indexed
  let foundNode: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | null = null;

  function visit(node: ts.Node) {
    if (foundNode) return;
    const nodeLine = sf!.getLineAndCharacterOfPosition(node.getStart(sf!)).line;

    if (nodeLine === targetLine || nodeLine === targetLine - 1 || nodeLine === targetLine + 1) {
      if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
        foundNode = node;
        return;
      }
    }

    // Check variable declarations with arrow/function initializers
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const initLine = sf!.getLineAndCharacterOfPosition(node.initializer.getStart(sf!)).line;
      if (initLine >= targetLine - 1 && initLine <= targetLine + 1) {
        if (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) {
          foundNode = node.initializer;
          return;
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);
  if (!foundNode) return null;

  const body = getBody(foundNode);
  if (!body) return null;

  // Count statements
  const statements = ts.isBlock(body) ? body.statements : [];
  const bodySize = statements.length;

  // Too large to be a wrapper
  if (bodySize > 5) return null;
  // Empty function is not a wrapper
  if (bodySize === 0) return null;

  // Look for a single dominant call expression
  const callTargets: string[] = [];
  for (const stmt of statements) {
    findCallTargets(stmt, callTargets);
  }

  // A wrapper typically has 1-2 calls, with one being the main forwarding call
  if (callTargets.length === 0 || callTargets.length > 3) return null;

  return {
    callTarget: callTargets[0],
    bodySize,
  };
}

function getBody(node: ts.Node): ts.Block | ts.ConciseBody | null {
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) return node.body ?? null;
  if (ts.isArrowFunction(node)) return node.body;
  return null;
}

function findCallTargets(node: ts.Node, targets: string[]): void {
  if (ts.isCallExpression(node)) {
    const expr = node.expression;
    if (ts.isIdentifier(expr)) {
      targets.push(expr.text);
    } else if (ts.isPropertyAccessExpression(expr)) {
      // Collect the full dotted name
      const parts: string[] = [expr.name.text];
      let current: ts.Expression = expr.expression;
      while (ts.isPropertyAccessExpression(current)) {
        parts.unshift(current.name.text);
        current = current.expression;
      }
      if (ts.isIdentifier(current)) parts.unshift(current.text);
      targets.push(parts.join('.'));
    }
  }

  // Also check return statements with calls
  if (ts.isReturnStatement(node) && node.expression) {
    findCallTargets(node.expression, targets);
    return;
  }

  ts.forEachChild(node, (child) => findCallTargets(child, targets));
}
