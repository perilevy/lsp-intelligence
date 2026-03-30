import ts from 'typescript';
import type { ExportedDeclaration } from './extractExports.js';

export interface ParamShape {
  name: string;
  optional: boolean;
  rest: boolean;
  typeText?: string;
}

export interface MemberShape {
  name: string;
  optional?: boolean;
  typeText?: string;
}

export interface DeclarationShape {
  name: string;
  kind: ExportedDeclaration['kind'];
  line: number;
  signatureText: string;
  params?: ParamShape[];
  returnTypeText?: string;
  members?: MemberShape[];
  enumMembers?: string[];
  exportedAs?: string[];
  moduleSpecifier?: string;
}

/**
 * Extract the shape of an exported declaration for diffing.
 * Works on the TS AST node near the export's line.
 */
export function extractDeclarationShape(
  sf: ts.SourceFile,
  exp: ExportedDeclaration,
): DeclarationShape {
  const base: DeclarationShape = {
    name: exp.name,
    kind: exp.kind,
    line: exp.line,
    signatureText: '',
    exportedAs: exp.exportedAs,
    moduleSpecifier: exp.moduleSpecifier,
  };

  // Find the node at the export's line
  const node = findNodeAtLine(sf, exp.line - 1);
  if (!node) return { ...base, signatureText: `${exp.kind} ${exp.name}` };

  // Function
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
    base.params = extractParams(node);
    base.returnTypeText = node.type ? node.type.getText(sf) : undefined;
    base.signatureText = `function ${exp.name}(${formatParams(base.params)}): ${base.returnTypeText ?? 'unknown'}`;
    return base;
  }

  // Method (inside class)
  if (ts.isMethodDeclaration(node)) {
    base.params = extractParams(node);
    base.returnTypeText = node.type ? node.type.getText(sf) : undefined;
    base.signatureText = `method ${exp.name}(${formatParams(base.params)})`;
    return base;
  }

  // Interface
  if (ts.isInterfaceDeclaration(node)) {
    base.members = extractMembers(node, sf);
    base.signatureText = `interface ${exp.name} { ${base.members.map((m) => m.name).join(', ')} }`;
    return base;
  }

  // Type alias
  if (ts.isTypeAliasDeclaration(node)) {
    base.signatureText = `type ${exp.name} = ${node.type.getText(sf).substring(0, 100)}`;
    return base;
  }

  // Enum
  if (ts.isEnumDeclaration(node)) {
    base.enumMembers = node.members.map((m) => ts.isIdentifier(m.name) ? m.name.text : m.name.getText(sf));
    base.signatureText = `enum ${exp.name} { ${base.enumMembers.join(', ')} }`;
    return base;
  }

  // Variable
  if (ts.isVariableStatement(node)) {
    for (const decl of node.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.name.text === exp.name) {
        if (decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
          base.params = extractParams(decl.initializer);
          base.returnTypeText = decl.initializer.type ? decl.initializer.type.getText(sf) : undefined;
          base.signatureText = `const ${exp.name} = (${formatParams(base.params)}) => ${base.returnTypeText ?? '...'}`;
        } else {
          base.signatureText = `const ${exp.name}: ${decl.type?.getText(sf) ?? 'unknown'}`;
        }
        return base;
      }
    }
  }

  // Class
  if (ts.isClassDeclaration(node)) {
    base.members = [];
    for (const member of node.members) {
      if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name)) {
        base.members.push({ name: member.name.text });
      } else if (ts.isPropertyDeclaration(member) && ts.isIdentifier(member.name)) {
        base.members.push({
          name: member.name.text,
          optional: !!member.questionToken,
          typeText: member.type?.getText(sf),
        });
      }
    }
    base.signatureText = `class ${exp.name} { ${base.members.map((m) => m.name).join(', ')} }`;
    return base;
  }

  base.signatureText = `${exp.kind} ${exp.name}`;
  return base;
}

function extractParams(node: ts.FunctionLikeDeclaration): ParamShape[] {
  return node.parameters.map((p) => ({
    name: ts.isIdentifier(p.name) ? p.name.text : p.name.getText(),
    optional: !!p.questionToken || !!p.initializer,
    rest: !!p.dotDotDotToken,
    typeText: p.type?.getText() ?? undefined,
  }));
}

function extractMembers(node: ts.InterfaceDeclaration, sf: ts.SourceFile): MemberShape[] {
  return node.members
    .filter((m): m is ts.PropertySignature => ts.isPropertySignature(m))
    .map((m) => ({
      name: ts.isIdentifier(m.name) ? m.name.text : m.name.getText(sf),
      optional: !!m.questionToken,
      typeText: m.type?.getText(sf),
    }));
}

function formatParams(params: ParamShape[]): string {
  return params.map((p) => `${p.rest ? '...' : ''}${p.name}${p.optional ? '?' : ''}`).join(', ');
}

function findNodeAtLine(sf: ts.SourceFile, line0: number): ts.Node | undefined {
  let found: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (found) return;
    const nodeLine = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
    if (nodeLine === line0 || nodeLine === line0 + 1 || nodeLine === line0 - 1) {
      // Prefer specific declaration types
      if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) ||
          ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) ||
          ts.isEnumDeclaration(node) || ts.isVariableStatement(node)) {
        found = node;
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return found;
}
