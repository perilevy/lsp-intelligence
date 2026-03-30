import ts from 'typescript';

/**
 * Exported declaration — the shared type used by api_guard and root_cause_trace.
 */
export interface ExportedDeclaration {
  name: string;
  exportedAs: string[];
  kind: 'function' | 'class' | 'interface' | 'type' | 'enum' | 'const' | 'var' | 'default' | 'reexport' | 'cjs' | 'unknown';
  filePath: string;
  line: number;
  isTypeOnly?: boolean;
  moduleSpecifier?: string;
}

/**
 * Extract all exports from a TypeScript/JavaScript source file using the TS AST.
 * Supports ESM (export function, export const, export { }, export * from, export default)
 * and basic CJS (module.exports, exports.foo).
 */
export function extractExports(sf: ts.SourceFile): ExportedDeclaration[] {
  const exports: ExportedDeclaration[] = [];
  const filePath = sf.fileName;

  function visit(node: ts.Node) {
    // ESM: export function foo() {}
    if (ts.isFunctionDeclaration(node) && hasExportModifier(node) && node.name) {
      exports.push({
        name: node.name.text,
        exportedAs: [node.name.text],
        kind: 'function',
        filePath,
        line: lineOf(node, sf),
      });
    }

    // ESM: export class Foo {}
    if (ts.isClassDeclaration(node) && hasExportModifier(node) && node.name) {
      exports.push({
        name: node.name.text,
        exportedAs: [node.name.text],
        kind: 'class',
        filePath,
        line: lineOf(node, sf),
      });
    }

    // ESM: export interface Foo {}
    if (ts.isInterfaceDeclaration(node) && hasExportModifier(node)) {
      exports.push({
        name: node.name.text,
        exportedAs: [node.name.text],
        kind: 'interface',
        filePath,
        line: lineOf(node, sf),
        isTypeOnly: true,
      });
    }

    // ESM: export type Foo = ...
    if (ts.isTypeAliasDeclaration(node) && hasExportModifier(node)) {
      exports.push({
        name: node.name.text,
        exportedAs: [node.name.text],
        kind: 'type',
        filePath,
        line: lineOf(node, sf),
        isTypeOnly: true,
      });
    }

    // ESM: export enum Foo {}
    if (ts.isEnumDeclaration(node) && hasExportModifier(node)) {
      exports.push({
        name: node.name.text,
        exportedAs: [node.name.text],
        kind: 'enum',
        filePath,
        line: lineOf(node, sf),
      });
    }

    // ESM: export const foo = ..., export let bar = ...
    if (ts.isVariableStatement(node) && hasExportModifier(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          exports.push({
            name: decl.name.text,
            exportedAs: [decl.name.text],
            kind: node.declarationList.flags & ts.NodeFlags.Const ? 'const' : 'var',
            filePath,
            line: lineOf(node, sf),
          });
        }
      }
    }

    // ESM: export default ...
    if (ts.isExportAssignment(node) && !node.isExportEquals) {
      const name = ts.isIdentifier(node.expression) ? node.expression.text : 'default';
      exports.push({
        name,
        exportedAs: ['default'],
        kind: 'default',
        filePath,
        line: lineOf(node, sf),
      });
    }

    // ESM: export { foo, bar as baz }
    if (ts.isExportDeclaration(node)) {
      const moduleSpec = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
        ? node.moduleSpecifier.text : undefined;

      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const spec of node.exportClause.elements) {
          const localName = (spec.propertyName ?? spec.name).text;
          const exportedName = spec.name.text;
          exports.push({
            name: localName,
            exportedAs: [exportedName],
            kind: moduleSpec ? 'reexport' : 'unknown',
            filePath,
            line: lineOf(spec, sf),
            isTypeOnly: node.isTypeOnly || spec.isTypeOnly,
            moduleSpecifier: moduleSpec,
          });
        }
      } else if (!node.exportClause && moduleSpec) {
        // export * from '...'
        exports.push({
          name: '*',
          exportedAs: ['*'],
          kind: 'reexport',
          filePath,
          line: lineOf(node, sf),
          moduleSpecifier: moduleSpec,
        });
      }
    }

    // CJS: module.exports = ... or module.exports.foo = ...
    if (ts.isExpressionStatement(node) && ts.isBinaryExpression(node.expression)) {
      const left = node.expression.left;
      if (ts.isPropertyAccessExpression(left)) {
        const text = getPropertyChain(left);
        if (text === 'module.exports') {
          exports.push({
            name: 'default',
            exportedAs: ['default'],
            kind: 'cjs',
            filePath,
            line: lineOf(node, sf),
          });
        } else if (text.startsWith('module.exports.')) {
          const name = text.slice('module.exports.'.length);
          exports.push({
            name,
            exportedAs: [name],
            kind: 'cjs',
            filePath,
            line: lineOf(node, sf),
          });
        } else if (text.startsWith('exports.')) {
          const name = text.slice('exports.'.length);
          exports.push({
            name,
            exportedAs: [name],
            kind: 'cjs',
            filePath,
            line: lineOf(node, sf),
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);
  return exports;
}

function hasExportModifier(node: ts.Node): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return mods?.some((m: ts.Modifier) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function lineOf(node: ts.Node, sf: ts.SourceFile): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function getPropertyChain(node: ts.PropertyAccessExpression): string {
  const parts: string[] = [node.name.text];
  let current: ts.Expression = node.expression;
  while (ts.isPropertyAccessExpression(current)) {
    parts.unshift(current.name.text);
    current = current.expression;
  }
  if (ts.isIdentifier(current)) parts.unshift(current.text);
  return parts.join('.');
}
