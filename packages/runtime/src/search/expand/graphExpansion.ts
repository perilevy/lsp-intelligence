import ts from 'typescript';
import type { CodeCandidate } from '../types.js';
import type { LspEngine } from '../../engine/LspEngine.js';
import { parseSourceFile } from '../../analysis/ts/parseSourceFile.js';
import { absoluteCandidateKey, lspLocationToKey } from '../ranking/candidateIdentity.js';
import { buildSnippetFromFile } from '../../analysis/ts/snippets.js';
import { getAdapterGraphDenylist } from '../../adapters/registry.js';

/**
 * Core JS/TS runtime builtins that should never be promoted as implementation roots.
 * Framework-specific symbols (React hooks, Express Router, Next.js helpers, etc.)
 * are now contributed by Phase 2E adapters via getAdapterGraphDenylist().
 */
const CORE_DENYLIST = new Set([
  'fetch', 'console', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'Promise', 'JSON', 'Math', 'Object', 'Array', 'Map', 'Set', 'Date', 'Error',
  'require', 'import', 'exports', 'module',
  'document', 'window', 'process', 'global', 'globalThis',
  'addEventListener', 'removeEventListener', 'dispatchEvent',
]);

/** Lazily merged denylist: core builtins + all adapter-contributed framework symbols. */
let cachedDenylist: Set<string> | null = null;
function getEffectiveDenylist(): Set<string> {
  if (cachedDenylist) return cachedDenylist;
  const merged = new Set(CORE_DENYLIST);
  for (const sym of getAdapterGraphDenylist()) merged.add(sym);
  cachedDenylist = merged;
  return merged;
}

export interface GraphExpansionResult {
  promoted: Map<string, { scoreDelta: number; evidence: string[] }>;
  derived: CodeCandidate[];
  warnings: string[];
}

/**
 * Expand top candidates toward implementation roots.
 * Detects wrappers, follows definitions, and promotes likely real implementations.
 * Derived candidates are returned for merging back into ranking.
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
      // Use absolute path for wrapper detection (candidates may be relative at this point)
      const absPath = candidate.filePath.startsWith('/')
        ? candidate.filePath
        : `${engine.workspaceRoot}/${candidate.filePath}`;

      const wrapperInfo = detectWrapper(absPath, candidate.line);
      if (!wrapperInfo) continue;

      // Skip if the call target is a builtin/framework symbol — not a real root
      const leafTarget = wrapperInfo.callTarget.split('.').pop() ?? wrapperInfo.callTarget;
      if (getEffectiveDenylist().has(leafTarget)) continue;

      // Demote wrapper — strength based on confidence
      const wrapperKey = absoluteCandidateKey(candidate);
      const demoteScore = Math.round(-2 * wrapperInfo.wrapperConfidence);
      promoted.set(wrapperKey, {
        scoreDelta: demoteScore,
        evidence: [
          `wrapper-of: ${wrapperInfo.callTarget}`,
          `body-size: ${wrapperInfo.bodySize}`,
          `wrapper-confidence: ${wrapperInfo.wrapperConfidence.toFixed(1)}`,
        ],
      });

      // Try to resolve the wrapped function via LSP and promote it
      try {
        const loc = await engine.resolveSymbol(wrapperInfo.callTarget);
        if (loc) {
          // Only promote if the resolved location is inside the workspace (project-local)
          const resolvedPath = loc.uri.startsWith('file://')
            ? decodeURIComponent(loc.uri.replace(/^file:\/\//, ''))
            : loc.uri;
          if (!resolvedPath.startsWith(engine.workspaceRoot)) continue;

          const derivedKey = lspLocationToKey(loc.uri, loc.position.line, engine.workspaceRoot, wrapperInfo.callTarget);

          if (!promoted.has(derivedKey)) {
            const promoteScore = Math.round(4 * wrapperInfo.wrapperConfidence);
            promoted.set(derivedKey, {
              scoreDelta: promoteScore,
              evidence: [
                'implementation-root',
                `wrapped-by: ${candidate.symbol ?? 'unknown'}`,
                `wrapper-confidence: ${wrapperInfo.wrapperConfidence.toFixed(1)}`,
              ],
            });

            // Create a derived candidate so it can be merged into results
            const derivedPath = loc.uri.startsWith('file://')
              ? decodeURIComponent(loc.uri.replace(/^file:\/\//, ''))
              : loc.uri;
            const derivedLine = loc.position.line + 1;
            const { snippet, context } = buildSnippetFromFile(derivedPath, derivedLine, 1);

            derived.push({
              candidateType: 'declaration',
              filePath: derivedPath,
              line: derivedLine,
              symbol: wrapperInfo.callTarget,
              kind: 'function',
              snippet,
              context,
              score: candidate.score + promoteScore,
              evidence: [
                'implementation-root',
                `wrapped-by: ${candidate.symbol ?? 'unknown'}`,
                `wrapper-confidence: ${wrapperInfo.wrapperConfidence.toFixed(1)}`,
                'graph-derived',
              ],
              sources: ['graph'],
            });
          }
        }
      } catch {
        // LSP resolution failed — skip
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
  /** 0-1 confidence that this is truly a wrapper. Higher = more likely. */
  wrapperConfidence: number;
}

function detectWrapper(filePath: string, line: number): WrapperInfo | null {
  const sf = parseSourceFile(filePath);
  if (!sf) return null;

  const targetLine = line - 1;
  let foundNode: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | null = null;

  function visit(node: ts.Node) {
    if (foundNode) return;
    const nodeLine = sf!.getLineAndCharacterOfPosition(node.getStart(sf!)).line;

    if (nodeLine >= targetLine - 1 && nodeLine <= targetLine + 1) {
      if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
        foundNode = node;
        return;
      }
    }

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

  const statements = ts.isBlock(body) ? body.statements : [];
  const bodySize = statements.length;

  if (bodySize > 5 || bodySize === 0) return null;

  const callTargets: string[] = [];
  for (const stmt of statements) {
    findCallTargets(stmt, callTargets);
  }

  if (callTargets.length === 0 || callTargets.length > 3) return null;

  // Confidence: 1 call + 1-2 statements = high, more calls/statements = lower
  const wrapperConfidence = callTargets.length === 1 && bodySize <= 2 ? 0.9
    : callTargets.length === 1 ? 0.7
    : callTargets.length === 2 && bodySize <= 3 ? 0.5
    : 0.3;

  return { callTarget: callTargets[0], bodySize, wrapperConfidence };
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

  if (ts.isReturnStatement(node) && node.expression) {
    findCallTargets(node.expression, targets);
    return;
  }

  ts.forEachChild(node, (child) => findCallTargets(child, targets));
}
