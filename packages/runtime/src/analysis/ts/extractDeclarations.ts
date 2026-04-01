import ts from 'typescript';
import * as path from 'path';
import type { DeclarationIndexEntry } from '../../search/types.js';

/**
 * Tokenize a symbol name: split camelCase, PascalCase, snake_case.
 */
function tokenize(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 1);
}

function pathTokenize(filePath: string): string[] {
  const rel = path.basename(filePath, path.extname(filePath));
  return tokenize(rel);
}

/**
 * Extract all declarations from a TypeScript source file using the TS compiler API.
 * Returns top-level and exported declarations with symbol tokens for searching.
 */
export function extractDeclarations(sf: ts.SourceFile): DeclarationIndexEntry[] {
  const entries: DeclarationIndexEntry[] = [];
  const filePath = sf.fileName;
  const pathToks = pathTokenize(filePath);

  function visit(node: ts.Node) {
    // Function declarations
    if (ts.isFunctionDeclaration(node) && node.name) {
      entries.push(makeEntry(node.name.text, 'function', node, sf, filePath, pathToks));
    }
    // Variable statements: export const/let/var
    else if (ts.isVariableStatement(node)) {
      const isExported = hasExportModifier(node);
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          const kind = decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
            ? 'function' : 'variable';
          entries.push({
            symbol: decl.name.text,
            kind,
            filePath,
            line: sf.getLineAndCharacterOfPosition(decl.getStart(sf)).line + 1,
            column: sf.getLineAndCharacterOfPosition(decl.getStart(sf)).character,
            isExported,
            pathTokens: pathToks,
            symbolTokens: tokenize(decl.name.text),
          });
        }
      }
    }
    // Class declarations
    else if (ts.isClassDeclaration(node) && node.name) {
      entries.push(makeEntry(node.name.text, 'class', node, sf, filePath, pathToks));
    }
    // Interface declarations
    else if (ts.isInterfaceDeclaration(node)) {
      entries.push(makeEntry(node.name.text, 'interface', node, sf, filePath, pathToks));
    }
    // Type alias declarations
    else if (ts.isTypeAliasDeclaration(node)) {
      entries.push(makeEntry(node.name.text, 'type', node, sf, filePath, pathToks));
    }
    // Enum declarations
    else if (ts.isEnumDeclaration(node)) {
      entries.push(makeEntry(node.name.text, 'enum', node, sf, filePath, pathToks));
    }

    // Only visit top-level children
    if (node === sf) {
      ts.forEachChild(node, visit);
    }
  }

  visit(sf);
  return entries;
}

function makeEntry(
  name: string,
  kind: string,
  node: ts.Node,
  sf: ts.SourceFile,
  filePath: string,
  pathToks: string[],
): DeclarationIndexEntry {
  const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return {
    symbol: name,
    kind,
    filePath,
    line: pos.line + 1,
    column: pos.character,
    isExported: hasExportModifier(node),
    pathTokens: pathToks,
    symbolTokens: tokenize(name),
  };
}

function hasExportModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const mods = ts.getModifiers(node);
  return mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}
