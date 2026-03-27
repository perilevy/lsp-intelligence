import { describe, it, expect } from 'vitest';
import { parseSourceFile } from '../src/analysis/ts/parseSourceFile.js';
import { evaluateStructuralPredicates } from '../src/analysis/ts/structuralPredicates.js';
import ts from 'typescript';
import * as path from 'path';

const FIXTURE_ROOT = path.resolve(import.meta.dirname, '..', 'test-fixtures', 'monorepo');
const STANDALONE_ROOT = path.resolve(import.meta.dirname, '..', 'test-fixtures', 'standalone');
const EFFECTS_FILE = path.join(STANDALONE_ROOT, 'web/src/effects.tsx');

function findCallExpression(sf: ts.SourceFile, calleeName: string, enclosingName?: string): ts.CallExpression | null {
  let found: ts.CallExpression | null = null;
  let currentEnclosing: string | undefined;

  function visit(node: ts.Node) {
    if (found) return;
    if (ts.isFunctionDeclaration(node) && node.name) currentEnclosing = node.name.text;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) currentEnclosing = node.name.text;

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === calleeName) {
      if (!enclosingName || currentEnclosing === enclosingName) {
        found = node;
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return found;
}

describe('Structural Predicates', () => {
  const sf = parseSourceFile(EFFECTS_FILE)!;

  it('detects conditional cleanup in ConditionalCleanupComponent', () => {
    const node = findCallExpression(sf, 'useEffect', 'ConditionalCleanupComponent');
    expect(node).not.toBeNull();
    const { matched } = evaluateStructuralPredicates(sf, node!, ['conditional', 'returns-cleanup', 'hook-callback']);
    expect(matched).toContain('conditional');
    expect(matched).toContain('hook-callback');
  });

  it('detects unconditional cleanup does NOT satisfy conditional', () => {
    const node = findCallExpression(sf, 'useEffect', 'UnconditionalCleanupComponent');
    expect(node).not.toBeNull();
    const { matched } = evaluateStructuralPredicates(sf, node!, ['conditional']);
    expect(matched).not.toContain('conditional');
  });

  it('detects returns-cleanup in UnconditionalCleanupComponent', () => {
    const node = findCallExpression(sf, 'useEffect', 'UnconditionalCleanupComponent');
    expect(node).not.toBeNull();
    const { matched } = evaluateStructuralPredicates(sf, node!, ['returns-cleanup']);
    expect(matched).toContain('returns-cleanup');
  });

  it('detects no-cleanup in NoCleanupComponent', () => {
    const node = findCallExpression(sf, 'useEffect', 'NoCleanupComponent');
    expect(node).not.toBeNull();
    const { matched } = evaluateStructuralPredicates(sf, node!, ['no-cleanup']);
    expect(matched).toContain('no-cleanup');
  });

  it('detects hook-callback on useEffect call', () => {
    const node = findCallExpression(sf, 'useEffect', 'NoCleanupComponent');
    expect(node).not.toBeNull();
    const { matched } = evaluateStructuralPredicates(sf, node!, ['hook-callback']);
    expect(matched).toContain('hook-callback');
  });

  it('detects has-try-catch in error handling fixture', () => {
    const errorSf = parseSourceFile(path.join(FIXTURE_ROOT, 'packages/app/src/errorBoundary.ts'))!;
    // Find handleItemError which has try/catch
    let tryNode: ts.Node | null = null;
    function visit(n: ts.Node) {
      if (tryNode) return;
      if (ts.isFunctionDeclaration(n) && n.name?.text === 'handleItemError') { tryNode = n; return; }
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === 'handleItemError') { tryNode = n; return; }
      ts.forEachChild(n, visit);
    }
    visit(errorSf);
    expect(tryNode).not.toBeNull();
    const { matched } = evaluateStructuralPredicates(errorSf, tryNode!, ['has-try-catch']);
    expect(matched).toContain('has-try-catch');
  });
});
