import ts from 'typescript';
import type { ChangeRecipe } from './changeRecipes.js';

/**
 * Phase 3B — Apply a change recipe to source text without touching disk.
 *
 * Returns modified source content as a string, or null if the recipe
 * cannot be applied (symbol not found, ambiguous match, etc.).
 *
 * The output is used to build a SnapshotResolver overlay so the TypeScript
 * program reflects the hypothetical change for semantic analysis.
 */

export interface VirtualEditResult {
  /** The modified source text */
  modifiedSource: string;
  /** Original signature text (for diff display) */
  originalSignature: string;
  /** New signature text after the change */
  newSignature: string;
  /** 0-indexed start position of the edit in the original source */
  editStart: number;
  /** 0-indexed end position (exclusive) in the original source */
  editEnd: number;
}

/**
 * Apply a change recipe to source text.
 * Returns null if the target symbol cannot be found.
 */
export function applyVirtualEdit(
  source: string,
  filePath: string,
  recipe: ChangeRecipe,
): VirtualEditResult | null {
  switch (recipe.kind) {
    case 'add_required_param':
    case 'add_optional_param':
      return applyAddParam(source, filePath, recipe.funcName, {
        name: recipe.paramName,
        type: recipe.paramType,
        optional: recipe.kind === 'add_optional_param',
      });
    case 'remove_param':
      return applyRemoveParam(source, filePath, recipe.funcName, recipe.paramName);
    case 'add_enum_member':
      return applyAddEnumMember(source, filePath, recipe.enumName, recipe.memberName, recipe.memberValue);
    case 'remove_enum_member':
      return applyRemoveEnumMember(source, filePath, recipe.enumName, recipe.memberName);
    case 'change_return_type':
      return applyChangeReturnType(source, filePath, recipe.funcName, recipe.newReturnType);
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Recipe implementations
// ---------------------------------------------------------------------------

function applyAddParam(
  source: string,
  filePath: string,
  funcName: string,
  param: { name: string; type: string; optional: boolean },
): VirtualEditResult | null {
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const funcNode = findFunction(sf, funcName);
  if (!funcNode) return null;

  const funcStart = funcNode.getStart(sf);
  const funcText = source.slice(funcStart, funcNode.end);
  const openParen = funcText.indexOf('(');
  const closeParen = findMatchingParen(funcText, openParen);
  if (openParen === -1 || closeParen === -1) return null;

  const paramListStart = funcStart + openParen + 1;
  const paramListEnd = funcStart + closeParen;
  const existing = source.slice(paramListStart, paramListEnd).trim();

  const newParam = `${param.name}${param.optional ? '?' : ''}: ${param.type}`;
  const newParamList = existing ? `${existing}, ${newParam}` : newParam;
  const modifiedSource = source.slice(0, paramListStart) + newParamList + source.slice(paramListEnd);

  return {
    modifiedSource,
    originalSignature: existing ? `(${existing})` : '()',
    newSignature: `(${newParamList})`,
    editStart: paramListStart,
    editEnd: paramListEnd,
  };
}

function applyRemoveParam(
  source: string,
  filePath: string,
  funcName: string,
  paramName: string,
): VirtualEditResult | null {
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const funcNode = findFunction(sf, funcName);
  if (!funcNode) return null;

  const funcStart = funcNode.getStart(sf);
  const funcText = source.slice(funcStart, funcNode.end);
  const openParen = funcText.indexOf('(');
  const closeParen = findMatchingParen(funcText, openParen);
  if (openParen === -1 || closeParen === -1) return null;

  const paramListStart = funcStart + openParen + 1;
  const paramListEnd = funcStart + closeParen;
  const existing = source.slice(paramListStart, paramListEnd).trim();

  // Simple comma-split removal (handles basic cases)
  const parts = splitParams(existing);
  const newParts = parts.filter((p) => {
    const name = p.trim().split(/[?:]/)[0].replace(/^\.\.\./, '').trim();
    return name !== paramName;
  });

  if (newParts.length === parts.length) return null; // param not found

  const newParamList = newParts.join(', ');
  const modifiedSource = source.slice(0, paramListStart) + newParamList + source.slice(paramListEnd);

  return {
    modifiedSource,
    originalSignature: `(${existing})`,
    newSignature: `(${newParamList})`,
    editStart: paramListStart,
    editEnd: paramListEnd,
  };
}

function applyAddEnumMember(
  source: string,
  filePath: string,
  enumName: string,
  memberName: string,
  memberValue?: string,
): VirtualEditResult | null {
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);

  let enumNode: ts.EnumDeclaration | undefined;
  ts.forEachChild(sf, (node) => {
    if (ts.isEnumDeclaration(node) && node.name.text === enumName) enumNode = node;
  });
  if (!enumNode) return null;

  const lastMember = enumNode.members[enumNode.members.length - 1];
  if (!lastMember) return null;

  const insertPos = lastMember.end;
  const valueStr = memberValue ? ` = ${memberValue}` : '';
  const memberStr = `,\n  ${memberName}${valueStr}`;
  const modifiedSource = source.slice(0, insertPos) + memberStr + source.slice(insertPos);

  const existing = enumNode.members.map((m) => (ts.isIdentifier(m.name) ? m.name.text : m.name.getText(sf))).join(', ');

  return {
    modifiedSource,
    originalSignature: `enum ${enumName} { ${existing} }`,
    newSignature: `enum ${enumName} { ${existing}, ${memberName} }`,
    editStart: insertPos,
    editEnd: insertPos,
  };
}

function applyRemoveEnumMember(
  source: string,
  filePath: string,
  enumName: string,
  memberName: string,
): VirtualEditResult | null {
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);

  let enumNode: ts.EnumDeclaration | undefined;
  ts.forEachChild(sf, (node) => {
    if (ts.isEnumDeclaration(node) && node.name.text === enumName) enumNode = node;
  });
  if (!enumNode) return null;

  const member = enumNode.members.find((m) =>
    ts.isIdentifier(m.name) && m.name.text === memberName,
  );
  if (!member) return null;

  // Remove the member and the comma before/after it
  let removeStart = member.pos;
  let removeEnd = member.end;

  // Include trailing comma if present
  if (source[removeEnd] === ',') removeEnd++;
  // Or include preceding comma
  const beforeMember = source.slice(enumNode.members.pos, member.pos);
  if (beforeMember.trimEnd().endsWith(',')) {
    removeStart = source.lastIndexOf(',', member.pos - 1);
  }

  const modifiedSource = source.slice(0, removeStart) + source.slice(removeEnd);
  const existing = enumNode.members.map((m) => (ts.isIdentifier(m.name) ? m.name.text : m.name.getText(sf))).join(', ');

  return {
    modifiedSource,
    originalSignature: `enum ${enumName} { ${existing} }`,
    newSignature: `enum ${enumName} { ${existing.replace(new RegExp(`(?:,\\s*)?${memberName}(?:,\\s*)?`), '')} }`,
    editStart: removeStart,
    editEnd: removeEnd,
  };
}

function applyChangeReturnType(
  source: string,
  filePath: string,
  funcName: string,
  newReturnType: string,
): VirtualEditResult | null {
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const funcNode = findFunction(sf, funcName);
  if (!funcNode) return null;

  const funcStart = funcNode.getStart(sf);
  const funcText = source.slice(funcStart, funcNode.end);

  // Find ): Type { pattern
  const returnTypeMatch = funcText.match(/\)\s*:\s*([^{=>]+?)(\s*(?:\{|=>))/);
  if (!returnTypeMatch) return null;

  const matchStart = funcStart + funcText.indexOf(returnTypeMatch[0]);
  const returnTypeStart = matchStart + funcText.indexOf(returnTypeMatch[0]) - funcText.indexOf(returnTypeMatch[0]) + returnTypeMatch[0].indexOf(returnTypeMatch[1]);
  // Simpler: find the colon after the closing ) and replace up to {
  const colonIdx = funcText.lastIndexOf('): ');
  if (colonIdx === -1) return null;

  const editStart = funcStart + colonIdx + 2;
  const bodyOrArrowMatch = funcText.slice(colonIdx + 2).match(/^([^{=]+?)(\s*(?:\{|=>))/);
  if (!bodyOrArrowMatch) return null;

  const editEnd = editStart + bodyOrArrowMatch[1].length;
  const originalType = source.slice(editStart, editEnd).trim();
  const modifiedSource = source.slice(0, editStart) + ` ${newReturnType} ` + source.slice(editEnd);

  return {
    modifiedSource,
    originalSignature: `(): ${originalType}`,
    newSignature: `(): ${newReturnType}`,
    editStart,
    editEnd,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function findFunction(sf: ts.SourceFile, funcName: string): ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | undefined {
  let found: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | undefined;
  ts.forEachChild(sf, (node) => {
    if (found) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === funcName) {
      found = node;
    } else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === funcName && decl.initializer) {
          if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
            found = decl.initializer;
          }
        }
      }
    }
  });
  return found;
}

function findMatchingParen(text: string, openPos: number): number {
  let depth = 0;
  for (let i = openPos; i < text.length; i++) {
    if (text[i] === '(') depth++;
    if (text[i] === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function splitParams(paramText: string): string[] {
  // Split by commas, respecting nested <>, (), {}
  const result: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of paramText) {
    if (ch === ',' && depth === 0) { result.push(current); current = ''; }
    else { if ('<({'.includes(ch)) depth++; if ('>)}'.includes(ch)) depth--; current += ch; }
  }
  if (current.trim()) result.push(current);
  return result;
}
