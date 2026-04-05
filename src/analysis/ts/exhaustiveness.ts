import ts from 'typescript';
import type { ProgramManager } from './program/ProgramManager.js';

/**
 * Phase 2D — Switch exhaustiveness intelligence.
 *
 * Answers questions that a graph product cannot answer from structure alone:
 * - "Which switches break if I add/remove this enum member?"
 * - "Is this switch exhaustive over its enum?"
 *
 * Builds on the TypeScript checker (Phase 2C) for accurate type information.
 */

export interface SwitchExhaustivenessResult {
  filePath: string;
  /** 1-indexed line number of the switch keyword */
  line: number;
  /** Enum members that are explicitly handled in this switch */
  handledMembers: string[];
  /** Enum members NOT handled (and no default case covers them) */
  missingMembers: string[];
  /** True if there is a default case (covers missing members at runtime) */
  hasDefaultCase: boolean;
  /** Whether the switch is exhaustive — all members covered OR has default */
  isExhaustive: boolean;
}

/**
 * Find all non-exhaustive switch statements for a given enum across the program.
 * "Non-exhaustive" means: missing at least one enum member AND no default case.
 *
 * This is the core "smarter than a graph" query: the TypeScript checker knows
 * which type is being switched on, and we can verify coverage precisely.
 */
export function findNonExhaustiveSwitches(
  program: ts.Program,
  enumFilePath: string,
  enumName: string,
): SwitchExhaustivenessResult[] {
  const checker = program.getTypeChecker();
  const allMembers = getEnumMembers(program, enumFilePath, enumName);
  if (!allMembers) return [];

  const results: SwitchExhaustivenessResult[] = [];

  for (const sf of program.getSourceFiles()) {
    if (sf.fileName.includes('node_modules') || sf.fileName.endsWith('.d.ts')) continue;

    ts.forEachChild(sf, function visitNode(node) {
      if (ts.isSwitchStatement(node)) {
        const result = analyzeSwitchForEnum(node, sf, checker, enumName, allMembers);
        if (result) results.push({ filePath: sf.fileName, ...result });
      }
      ts.forEachChild(node, visitNode);
    });
  }

  return results.filter((r) => !r.isExhaustive);
}

/**
 * Predict the exhaustiveness impact of adding a new enum member.
 * Returns which switches would become non-exhaustive — i.e., they currently
 * handle all members but would miss the new one.
 */
export function predictAddedMemberImpact(
  program: ts.Program,
  enumFilePath: string,
  enumName: string,
  newMemberName: string,
): {
  affectedSwitches: Array<{ filePath: string; line: number; missingMember: string }>;
  safeCount: number;
} {
  const checker = program.getTypeChecker();
  const currentMembers = getEnumMembers(program, enumFilePath, enumName);
  if (!currentMembers) return { affectedSwitches: [], safeCount: 0 };

  const affectedSwitches: Array<{ filePath: string; line: number; missingMember: string }> = [];
  let safeCount = 0;

  for (const sf of program.getSourceFiles()) {
    if (sf.fileName.includes('node_modules') || sf.fileName.endsWith('.d.ts')) continue;

    ts.forEachChild(sf, function visitNode(node) {
      if (ts.isSwitchStatement(node)) {
        const result = analyzeSwitchForEnum(node, sf, checker, enumName, currentMembers);
        if (result && result.handledMembers.length > 0) {
          // This switch uses the enum
          if (!result.hasDefaultCase) {
            // No default — adding a new member would make it non-exhaustive
            affectedSwitches.push({ filePath: sf.fileName, line: result.line, missingMember: newMemberName });
          } else {
            safeCount++;
          }
        }
      }
      ts.forEachChild(node, visitNode);
    });
  }

  return { affectedSwitches, safeCount };
}

/**
 * Get all switch exhaustiveness results for an enum, including exhaustive ones.
 * Useful for a full picture: which files use this enum in a switch.
 */
export function getAllSwitchResults(
  program: ts.Program,
  enumFilePath: string,
  enumName: string,
): SwitchExhaustivenessResult[] {
  const checker = program.getTypeChecker();
  const allMembers = getEnumMembers(program, enumFilePath, enumName);
  if (!allMembers) return [];

  const results: SwitchExhaustivenessResult[] = [];
  for (const sf of program.getSourceFiles()) {
    if (sf.fileName.includes('node_modules') || sf.fileName.endsWith('.d.ts')) continue;
    ts.forEachChild(sf, function visitNode(node) {
      if (ts.isSwitchStatement(node)) {
        const result = analyzeSwitchForEnum(node, sf, checker, enumName, allMembers);
        if (result) results.push({ filePath: sf.fileName, ...result });
      }
      ts.forEachChild(node, visitNode);
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getEnumMembers(program: ts.Program, filePath: string, enumName: string): string[] | null {
  const sf = program.getSourceFile(filePath);
  if (!sf) return null;
  let members: string[] | null = null;
  ts.forEachChild(sf, (node) => {
    if (ts.isEnumDeclaration(node) && node.name.text === enumName) {
      members = node.members.map((m) => (ts.isIdentifier(m.name) ? m.name.text : m.name.getText(sf)));
    }
  });
  return members;
}

interface SwitchAnalysis {
  line: number;
  handledMembers: string[];
  missingMembers: string[];
  hasDefaultCase: boolean;
  isExhaustive: boolean;
}

function analyzeSwitchForEnum(
  node: ts.SwitchStatement,
  sf: ts.SourceFile,
  checker: ts.TypeChecker,
  enumName: string,
  allMembers: string[],
): SwitchAnalysis | null {
  // Check if the switch expression uses the enum type
  const switchType = checker.getTypeAtLocation(node.expression);
  const typeSym = switchType.getSymbol() ?? (switchType as any).aliasSymbol;
  const typeStr = checker.typeToString(switchType);

  const usesEnum = typeSym?.name === enumName || typeStr === enumName;
  if (!usesEnum) {
    // Also check if any case clause uses EnumName.Member pattern
    const hasMemberAccess = hasCaseWithEnumAccess(node, enumName, allMembers, sf);
    if (!hasMemberAccess) return null;
  }

  const handled = new Set<string>();
  let hasDefaultCase = false;

  for (const clause of node.caseBlock.clauses) {
    if (ts.isDefaultClause(clause)) {
      hasDefaultCase = true;
    } else if (ts.isCaseClause(clause)) {
      const memberName = extractEnumMemberFromExpr(clause.expression, enumName, sf);
      if (memberName && allMembers.includes(memberName)) {
        handled.add(memberName);
      }
    }
  }

  if (handled.size === 0 && !hasDefaultCase) return null; // Not actually using this enum

  const missingMembers = allMembers.filter((m) => !handled.has(m));
  const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  return {
    line,
    handledMembers: [...handled],
    missingMembers,
    hasDefaultCase,
    isExhaustive: missingMembers.length === 0 || hasDefaultCase,
  };
}

function extractEnumMemberFromExpr(expr: ts.Expression, enumName: string, sf: ts.SourceFile): string | null {
  if (ts.isPropertyAccessExpression(expr)) {
    const obj = expr.expression;
    if (ts.isIdentifier(obj) && obj.text === enumName) {
      return expr.name.text;
    }
  }
  return null;
}

function hasCaseWithEnumAccess(
  node: ts.SwitchStatement,
  enumName: string,
  members: string[],
  sf: ts.SourceFile,
): boolean {
  for (const clause of node.caseBlock.clauses) {
    if (ts.isCaseClause(clause)) {
      const m = extractEnumMemberFromExpr(clause.expression, enumName, sf);
      if (m && members.includes(m)) return true;
    }
  }
  return false;
}
