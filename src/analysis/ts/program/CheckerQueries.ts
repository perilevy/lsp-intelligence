import ts from 'typescript';

/**
 * Focused TypeScript semantic query helpers built on a ts.Program.
 *
 * These answer questions that AST analysis alone cannot answer reliably.
 * All methods are read-only and do not modify the program state.
 *
 * Keep integration points narrow: callers should ask for specific facts,
 * not raw ts.Type objects.
 */
export class CheckerQueries {
  private checker: ts.TypeChecker;

  constructor(private readonly program: ts.Program) {
    this.checker = program.getTypeChecker();
  }

  // ---------------------------------------------------------------------------
  // Enum queries
  // ---------------------------------------------------------------------------

  /**
   * Get the string-valued members of an exported enum.
   * Returns null if the enum cannot be found in the program.
   */
  getEnumMembers(filePath: string, enumName: string): string[] | null {
    const sf = this.program.getSourceFile(filePath);
    if (!sf) return null;

    let enumDecl: ts.EnumDeclaration | undefined;
    ts.forEachChild(sf, (node) => {
      if (ts.isEnumDeclaration(node) && node.name.text === enumName) {
        enumDecl = node;
      }
    });
    if (!enumDecl) return null;

    return enumDecl.members.map((m) =>
      ts.isIdentifier(m.name) ? m.name.text : m.name.getText(sf),
    );
  }

  /**
   * Given a switch statement (by containing function / file and line),
   * return which enum members are handled and which are missing.
   */
  getSwitchExhaustiveness(filePath: string, enumFilePath: string, enumName: string): {
    handled: string[];
    missing: string[];
    isExhaustive: boolean;
  } | null {
    const allMembers = this.getEnumMembers(enumFilePath, enumName);
    if (!allMembers) return null;

    const sf = this.program.getSourceFile(filePath);
    if (!sf) return null;

    const handled = new Set<string>();
    const visit = (node: ts.Node) => {
      if (ts.isSwitchStatement(node)) {
        for (const clause of node.caseBlock.clauses) {
          if (ts.isCaseClause(clause)) {
            // Check if the case expression is an enum member access
            if (ts.isPropertyAccessExpression(clause.expression)) {
              const memberName = clause.expression.name.text;
              if (allMembers.includes(memberName)) {
                handled.add(memberName);
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);

    const missing = allMembers.filter((m) => !handled.has(m));
    return { handled: [...handled], missing, isExhaustive: missing.length === 0 };
  }

  // ---------------------------------------------------------------------------
  // Function / type queries
  // ---------------------------------------------------------------------------

  /**
   * Get the type text of an exported symbol in a file.
   * Returns a human-readable type string, or null if not found.
   */
  getExportedSymbolType(filePath: string, symbolName: string): string | null {
    const sf = this.program.getSourceFile(filePath);
    if (!sf) return null;

    let result: string | null = null;
    const visit = (node: ts.Node) => {
      if (result) return;
      // Function declarations
      if (ts.isFunctionDeclaration(node) && node.name?.text === symbolName) {
        const sym = this.checker.getSymbolAtLocation(node.name);
        if (sym) result = this.checker.typeToString(this.checker.getTypeOfSymbolAtLocation(sym, node));
        return;
      }
      // Variable declarations
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === symbolName) {
        const sym = this.checker.getSymbolAtLocation(node.name);
        if (sym) result = this.checker.typeToString(this.checker.getTypeOfSymbolAtLocation(sym, node));
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return result;
  }

  /**
   * Get parameter facts for an exported function: name, type text, optional status.
   */
  getFunctionParams(filePath: string, funcName: string): Array<{
    name: string;
    typeText: string;
    optional: boolean;
    rest: boolean;
  }> | null {
    const sf = this.program.getSourceFile(filePath);
    if (!sf) return null;

    let funcNode: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | undefined;
    const visit = (node: ts.Node) => {
      if (funcNode) return;
      if (ts.isFunctionDeclaration(node) && node.name?.text === funcName) {
        funcNode = node;
        return;
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === funcName) {
        if (node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
          funcNode = node.initializer;
          return;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    if (!funcNode) return null;

    return funcNode.parameters.map((p) => ({
      name: ts.isIdentifier(p.name) ? p.name.text : p.name.getText(sf),
      typeText: p.type ? p.type.getText(sf) : this.checker.typeToString(this.checker.getTypeAtLocation(p)),
      optional: !!p.questionToken || !!p.initializer,
      rest: !!p.dotDotDotToken,
    }));
  }

  /**
   * Get the return type text for an exported function.
   */
  getReturnType(filePath: string, funcName: string): string | null {
    const sf = this.program.getSourceFile(filePath);
    if (!sf) return null;

    let result: string | null = null;
    const visit = (node: ts.Node) => {
      if (result) return;
      if (ts.isFunctionDeclaration(node) && node.name?.text === funcName) {
        const sig = this.checker.getSignatureFromDeclaration(node);
        if (sig) result = this.checker.typeToString(sig.getReturnType());
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Diagnostics
  // ---------------------------------------------------------------------------

  /**
   * Get semantic diagnostics for a file.
   * Lighter than running the full LSP — useful for quick checks.
   */
  getSemanticDiagnostics(filePath: string): readonly ts.Diagnostic[] {
    const sf = this.program.getSourceFile(filePath);
    if (!sf) return [];
    try {
      return this.program.getSemanticDiagnostics(sf);
    } catch {
      return [];
    }
  }

  /**
   * Get all files in the program (resolved root names).
   */
  getProgramFiles(): string[] {
    return this.program.getSourceFiles()
      .map((sf) => sf.fileName)
      .filter((f) => !f.includes('node_modules') && !f.endsWith('.d.ts'));
  }
}
