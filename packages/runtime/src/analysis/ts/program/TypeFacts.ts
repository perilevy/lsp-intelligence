import type ts from 'typescript';
import type { CheckerQueries } from './CheckerQueries.js';

/**
 * Higher-level semantic facts derived from CheckerQueries.
 * These answer the kinds of questions that make the engine "obviously smarter":
 *
 * - "If I add this enum member, which switches break?"
 * - "Which places narrow this union and will now be wrong?"
 * - "If I make this parameter required, what calls become invalid?"
 */

// ---------------------------------------------------------------------------
// Enum facts
// ---------------------------------------------------------------------------

export interface EnumMemberFact {
  enumName: string;
  filePath: string;
  members: string[];
  isStringEnum: boolean;
}

/**
 * Get semantic facts about an enum, including all its current members.
 */
export function getEnumFacts(
  queries: CheckerQueries,
  filePath: string,
  enumName: string,
): EnumMemberFact | null {
  const members = queries.getEnumMembers(filePath, enumName);
  if (!members) return null;

  // Heuristic: string enum if members have string initializers
  // (CheckerQueries.getEnumMembers already returns the member names — we use type as a fact)
  return {
    enumName,
    filePath,
    members,
    isStringEnum: true, // TypeScript string enums are most common; refine in Phase 2D
  };
}

// ---------------------------------------------------------------------------
// Parameter compatibility facts
// ---------------------------------------------------------------------------

export interface ParamCompatibilityFact {
  funcName: string;
  filePath: string;
  params: Array<{
    name: string;
    typeText: string;
    optional: boolean;
    rest: boolean;
  }>;
  /** Whether any required parameters exist */
  hasRequiredParams: boolean;
  /** Minimum number of arguments required */
  minArity: number;
  /** Maximum arity (Infinity if rest param present) */
  maxArity: number;
}

/**
 * Get parameter compatibility facts for a function.
 * Used to answer "what callers would break if this param became required?"
 */
export function getParamFacts(
  queries: CheckerQueries,
  filePath: string,
  funcName: string,
): ParamCompatibilityFact | null {
  const params = queries.getFunctionParams(filePath, funcName);
  if (!params) return null;

  const required = params.filter((p) => !p.optional && !p.rest);
  const hasRest = params.some((p) => p.rest);

  return {
    funcName,
    filePath,
    params,
    hasRequiredParams: required.length > 0,
    minArity: required.length,
    maxArity: hasRest ? Infinity : params.length,
  };
}

// ---------------------------------------------------------------------------
// Exhaustiveness facts
// ---------------------------------------------------------------------------

export interface SwitchExhaustivenessFact {
  enumName: string;
  handledMembers: string[];
  missingMembers: string[];
  isExhaustive: boolean;
  /**
   * Files where the enum is used in a switch that would be non-exhaustive
   * if a new member were added.
   */
  affectedFiles: string[];
}

/**
 * For a given enum, check all files in the program for switch statements
 * that use it, and determine which would break if a new member is added.
 *
 * This is a preview of Phase 2D exhaustiveness intelligence.
 */
export function getSwitchExhaustivenessAcrossFiles(
  queries: CheckerQueries,
  enumFilePath: string,
  enumName: string,
): SwitchExhaustivenessFact | null {
  const allMembers = queries.getEnumMembers(enumFilePath, enumName);
  if (!allMembers) return null;

  const affectedFiles: string[] = [];
  let allHandled = new Set<string>();
  let allMissing = new Set(allMembers);

  for (const filePath of queries.getProgramFiles()) {
    const result = queries.getSwitchExhaustiveness(filePath, enumFilePath, enumName);
    if (!result) continue;
    if (result.handled.length > 0) {
      affectedFiles.push(filePath);
      result.handled.forEach((m) => allHandled.add(m));
      result.missing.forEach((m) => allMissing.add(m));
    }
  }

  const missing = allMembers.filter((m) => !allHandled.has(m));
  return {
    enumName,
    handledMembers: [...allHandled],
    missingMembers: missing,
    isExhaustive: missing.length === 0,
    affectedFiles,
  };
}
