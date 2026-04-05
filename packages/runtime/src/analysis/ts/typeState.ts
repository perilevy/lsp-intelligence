import ts from 'typescript';

/**
 * Phase 2D — Type-state and narrowing intelligence.
 *
 * Finds places in the code that depend on the specific shape of a type:
 * type guards, discriminant checks, narrowing expressions.
 *
 * Answers: "Which places narrow this union and will be wrong if I change it?"
 */

export type NarrowingKind =
  | 'typeof-check'       // typeof x === 'string'
  | 'instanceof-check'   // x instanceof Foo
  | 'discriminant-check' // x.kind === 'foo'
  | 'user-defined-guard' // function isFoo(x): x is Foo
  | 'nullish-check'      // x !== null, x != undefined
  | 'truthiness-check';  // if (x) { ... }

export interface TypeNarrowingUsage {
  filePath: string;
  line: number;
  narrowingKind: NarrowingKind;
  /** The symbol being narrowed */
  symbolName: string;
  /** The type/value being checked against */
  checkValue: string;
}

export interface TypeGuardFunction {
  filePath: string;
  line: number;
  funcName: string;
  /** The type being guarded: x is T */
  guardedType: string;
}

/**
 * Find all type narrowing usages for a given type name across the program.
 * Used to identify code that depends on the specific shape of a discriminated union.
 */
export function findTypeNarrowingUsages(
  program: ts.Program,
  typeName: string,
): TypeNarrowingUsage[] {
  const results: TypeNarrowingUsage[] = [];

  for (const sf of program.getSourceFiles()) {
    if (sf.fileName.includes('node_modules') || sf.fileName.endsWith('.d.ts')) continue;

    ts.forEachChild(sf, function visitNode(node) {
      // Discriminant checks: x.kind === 'foo', x.type === 'bar'
      if (ts.isBinaryExpression(node) &&
          (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
           node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken)) {
        const lhsName = extractPropertyAccessBase(node.left);
        if (lhsName && looksLikeTypeName(lhsName, typeName)) {
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          const checkValue = node.right.getText(sf);
          results.push({ filePath: sf.fileName, line, narrowingKind: 'discriminant-check', symbolName: lhsName, checkValue });
        }
      }

      // typeof checks: typeof x === 'string'
      if (ts.isTypeOfExpression(node)) {
        const parent = node.parent;
        if (parent && ts.isBinaryExpression(parent)) {
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          const sym = node.expression.getText(sf);
          if (sym.includes(typeName)) {
            results.push({ filePath: sf.fileName, line, narrowingKind: 'typeof-check', symbolName: sym, checkValue: parent.right.getText(sf) });
          }
        }
      }

      // instanceof checks: x instanceof Foo
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword) {
        const rhs = node.right.getText(sf);
        if (rhs === typeName) {
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          results.push({ filePath: sf.fileName, line, narrowingKind: 'instanceof-check', symbolName: node.left.getText(sf), checkValue: rhs });
        }
      }

      ts.forEachChild(node, visitNode);
    });
  }

  return results;
}

/**
 * Find all user-defined type guards that check for a specific type.
 * e.g., `function isFoo(x: unknown): x is Foo`
 */
export function findTypeGuardFunctions(
  program: ts.Program,
  typeName: string,
): TypeGuardFunction[] {
  const results: TypeGuardFunction[] = [];

  for (const sf of program.getSourceFiles()) {
    if (sf.fileName.includes('node_modules') || sf.fileName.endsWith('.d.ts')) continue;

    ts.forEachChild(sf, (node) => {
      if ((ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
          node.type && ts.isTypePredicateNode(node.type)) {
        const predicate = node.type;
        const guardedTypeName = predicate.type?.getText(sf) ?? '';
        if (guardedTypeName === typeName || guardedTypeName.includes(typeName)) {
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          const funcName = ts.isFunctionDeclaration(node) && node.name ? node.name.text : '<anonymous>';
          results.push({ filePath: sf.fileName, line, funcName, guardedType: guardedTypeName });
        }
      }
    });
  }

  return results;
}

/**
 * Find all usages of a discriminant field (e.g., `.kind`, `.type`, `.tag`)
 * that compare against specific string values.
 * Used to identify switch/if exhaustiveness over discriminated unions.
 */
export function findDiscriminantUsages(
  program: ts.Program,
  discriminantField: string,
): Array<{ filePath: string; line: number; checkedValue: string }> {
  const results: Array<{ filePath: string; line: number; checkedValue: string }> = [];

  for (const sf of program.getSourceFiles()) {
    if (sf.fileName.includes('node_modules') || sf.fileName.endsWith('.d.ts')) continue;

    ts.forEachChild(sf, function visitNode(node) {
      if (ts.isBinaryExpression(node) &&
          node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
          ts.isPropertyAccessExpression(node.left) &&
          node.left.name.text === discriminantField) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        const checkedValue = node.right.getText(sf).replace(/['"]/g, '');
        results.push({ filePath: sf.fileName, line, checkedValue });
      }
      ts.forEachChild(node, visitNode);
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function extractPropertyAccessBase(expr: ts.Expression): string | null {
  if (ts.isPropertyAccessExpression(expr)) {
    return expr.expression.getText();
  }
  return null;
}

function looksLikeTypeName(symbolName: string, typeName: string): boolean {
  // Heuristic: the base variable name contains the type name (case-insensitive)
  return symbolName.toLowerCase().includes(typeName.toLowerCase());
}
