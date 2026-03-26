import ts from 'typescript';
import * as path from 'path';
import type { UsageIndexEntry } from '../../search/types.js';

function pathTokenize(filePath: string): string[] {
  return path.basename(filePath, path.extname(filePath))
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 1);
}

/**
 * Extract all identifier usage sites from a TypeScript source file.
 * Indexes: call expressions, member calls, import specifiers, JSX tags.
 */
export function extractUsages(sf: ts.SourceFile): UsageIndexEntry[] {
  const entries: UsageIndexEntry[] = [];
  const filePath = sf.fileName;
  const pathToks = pathTokenize(filePath);

  // Track enclosing symbol for context
  let enclosingSymbol: string | undefined;
  let enclosingKind: string | undefined;

  function visit(node: ts.Node) {
    // Track enclosing function/class/method for context
    if (ts.isFunctionDeclaration(node) && node.name) {
      enclosingSymbol = node.name.text;
      enclosingKind = 'function';
    } else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer &&
            (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
          enclosingSymbol = decl.name.text;
          enclosingKind = 'function';
        }
      }
    } else if (ts.isClassDeclaration(node) && node.name) {
      enclosingSymbol = node.name.text;
      enclosingKind = 'class';
    } else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
      enclosingSymbol = node.name.text;
      enclosingKind = 'method';
    }

    // Call expressions: foo(), bar.baz()
    if (ts.isCallExpression(node)) {
      const expr = node.expression;

      // Simple call: useEffect(...)
      if (ts.isIdentifier(expr)) {
        entries.push(makeUsage(expr.text, expr.text, 'call', node, sf, filePath, pathToks, enclosingSymbol, enclosingKind));
      }
      // Member call: Promise.all(...), sdk.Items.get(...)
      else if (ts.isPropertyAccessExpression(expr)) {
        const fullName = getPropertyAccessText(expr);
        const leafName = expr.name.text;
        entries.push(makeUsage(fullName, leafName, 'member-call', node, sf, filePath, pathToks, enclosingSymbol, enclosingKind));
      }
    }

    // Import declarations: import { X } from "module"
    if (ts.isImportDeclaration(node) && node.importClause) {
      const clause = node.importClause;

      // Default import
      if (clause.name) {
        entries.push(makeUsage(clause.name.text, clause.name.text, 'import', clause.name, sf, filePath, pathToks, undefined, undefined));
      }

      // Named imports: { A, B }
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const spec of clause.namedBindings.elements) {
          entries.push(makeUsage(spec.name.text, spec.name.text, 'import', spec, sf, filePath, pathToks, undefined, undefined));
        }
      }

      // Namespace import: * as X
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        entries.push(makeUsage(clause.namedBindings.name.text, clause.namedBindings.name.text, 'import', clause.namedBindings, sf, filePath, pathToks, undefined, undefined));
      }
    }

    // JSX elements: <Component ... />
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagName = node.tagName;
      if (ts.isIdentifier(tagName) && /^[A-Z]/.test(tagName.text)) {
        entries.push(makeUsage(tagName.text, tagName.text, 'jsx-tag', node, sf, filePath, pathToks, enclosingSymbol, enclosingKind));
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);
  return entries;
}

function makeUsage(
  identifier: string,
  normalizedIdentifier: string,
  kind: UsageIndexEntry['kind'],
  node: ts.Node,
  sf: ts.SourceFile,
  filePath: string,
  pathToks: string[],
  enclosingSymbol: string | undefined,
  enclosingKind: string | undefined,
): UsageIndexEntry {
  const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return {
    identifier,
    normalizedIdentifier,
    kind,
    filePath,
    line: pos.line + 1,
    column: pos.character,
    enclosingSymbol,
    enclosingKind,
    pathTokens: pathToks,
  };
}

function getPropertyAccessText(node: ts.PropertyAccessExpression): string {
  const parts: string[] = [node.name.text];
  let current: ts.Expression = node.expression;
  while (ts.isPropertyAccessExpression(current)) {
    parts.unshift(current.name.text);
    current = current.expression;
  }
  if (ts.isIdentifier(current)) {
    parts.unshift(current.text);
  }
  return parts.join('.');
}
