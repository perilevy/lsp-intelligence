import { z } from 'zod';
import * as path from 'path';
import * as fs from 'fs';
import { defineTool } from '../tools/registry.js';
import { relativePath } from '../engine/positions.js';
import { applyVirtualEdit } from '../analysis/ts/applyVirtualEdit.js';
import { programManager } from '../analysis/ts/program/ProgramManager.js';
import { CheckerQueries } from '../analysis/ts/program/CheckerQueries.js';
import { analyzeCallSiteCompatibility } from '../analysis/ts/compatibility.js';
import { findNonExhaustiveSwitches, predictAddedMemberImpact } from '../analysis/ts/exhaustiveness.js';
import { diffExportSets } from '../analysis/ts/diffDeclarationShape.js';
import { extractExports } from '../analysis/ts/extractExports.js';
import { extractDeclarationShape } from '../analysis/ts/extractDeclarationShape.js';
import { parseSourceContent } from '../analysis/ts/parseSourceFile.js';
import { buildStaticSnapshotResolver } from '../session/SnapshotResolver.js';
import type { ChangeRecipe } from '../analysis/ts/changeRecipes.js';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface SimulationResult {
  recipe: string;
  targetFile: string;
  targetSymbol: string;
  /** Human-readable description of the virtual edit */
  editDescription: string;
  /** Diff of the signature (original → new) */
  signatureDiff: { original: string; modified: string };
  /** Callers that would break */
  breakingCallers: Array<{ filePath: string; relativePath: string; line: number; issue: string }>;
  /** Callers that remain compatible */
  compatibleCallerCount: number;
  /** API contract impact */
  contractImpact: Array<{ name: string; kind: string; risk: string; reason: string }>;
  /** For enum changes: switches that become non-exhaustive */
  exhaustivenessImpact: Array<{ filePath: string; relativePath: string; line: number; missingMembers: string[] }>;
  /** Semantic diagnostics in the virtual program (errors from the overlay) */
  diagnosticsDelta: { newErrors: number; sample: string[] };
  /** One-sentence verdict */
  summary: string;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// MCP tool definition
// ---------------------------------------------------------------------------

export const simulateChange = defineTool({
  name: 'simulate_change',
  description:
    'Speculative change simulation (Phase 3B): predict what breaks if you apply a change WITHOUT touching disk. ' +
    'Creates an in-memory overlay of the modified file, rebuilds the TypeScript program over it, and reports: ' +
    'breaking callers, exhaustiveness impact, and API contract delta. ' +
    'Currently supported recipes: add_required_param, add_optional_param, remove_param, add_enum_member, remove_enum_member.',
  schema: z.object({
    file_path: z.string().describe('File containing the symbol to change (absolute or workspace-relative)'),
    recipe: z.enum([
      'add_required_param',
      'add_optional_param',
      'remove_param',
      'add_enum_member',
      'remove_enum_member',
    ]).describe('Kind of change to simulate'),
    symbol: z.string().describe('Function name (for param recipes) or enum name (for enum recipes)'),
    param_name: z.string().optional().describe('Parameter name (required for param recipes)'),
    param_type: z.string().default('unknown').describe('Parameter type annotation (for add_param recipes)'),
    member_name: z.string().optional().describe('Enum member name (required for enum recipes)'),
    member_value: z.string().optional().describe('Enum member value (optional for add_enum_member)'),
  }),

  async handler(params, engine) {
    const warnings: string[] = [];

    // Resolve file path
    const filePath = path.isAbsolute(params.file_path)
      ? params.file_path
      : path.join(engine.workspaceRoot, params.file_path);

    if (!fs.existsSync(filePath)) {
      return { summary: `File not found: ${params.file_path}`, warnings: [`File not found: ${filePath}`] };
    }

    // Build the recipe
    const recipe: ChangeRecipe = buildRecipe(params, filePath);
    if (!recipe) {
      return { summary: 'Could not build recipe — check param_name or member_name', warnings };
    }

    // Step 1: Apply the virtual edit
    const source = fs.readFileSync(filePath, 'utf-8');
    const editResult = applyVirtualEdit(source, filePath, recipe);
    if (!editResult) {
      return {
        summary: `Could not apply recipe — symbol "${params.symbol}" not found in ${params.file_path}`,
        warnings: [`Symbol "${params.symbol}" not found in ${filePath}`],
      };
    }

    // Step 2: Build overlay program with the virtual edit
    const resolver = buildStaticSnapshotResolver({ [filePath]: editResult.modifiedSource });
    const overlayProgram = programManager.getOrBuild(engine.workspaceRoot, resolver);
    const overlayQueries = new CheckerQueries(overlayProgram);

    // Step 3: Analyze breaking callers (for param changes)
    const breakingCallers: SimulationResult['breakingCallers'] = [];
    let compatibleCallerCount = 0;

    if (recipe.kind === 'add_required_param' || recipe.kind === 'add_optional_param' || recipe.kind === 'remove_param') {
      const funcParams = overlayQueries.getFunctionParams(filePath, params.symbol);
      if (funcParams) {
        const required = funcParams.filter((p) => !p.optional && !p.rest).length;
        const max = funcParams.length;
        const report = analyzeCallSiteCompatibility(overlayProgram, filePath, params.symbol, required, max);
        compatibleCallerCount = report.compatibleCallers.length;
        for (const c of report.breakingCallers) {
          breakingCallers.push({
            filePath: c.filePath,
            relativePath: relativePath(c.filePath, engine.workspaceRoot),
            line: c.line,
            issue: c.issue ?? 'incompatible call',
          });
        }
      }
    }

    // Step 4: Exhaustiveness impact (for enum changes)
    const exhaustivenessImpact: SimulationResult['exhaustivenessImpact'] = [];

    if (recipe.kind === 'add_enum_member' && params.member_name) {
      const impact = predictAddedMemberImpact(overlayProgram, filePath, params.symbol, params.member_name);
      for (const s of impact.affectedSwitches) {
        exhaustivenessImpact.push({
          filePath: s.filePath,
          relativePath: relativePath(s.filePath, engine.workspaceRoot),
          line: s.line,
          missingMembers: [s.missingMember],
        });
      }
    }

    if (recipe.kind === 'remove_enum_member') {
      // After removal: find any switches that now reference the removed member (would produce TS2339)
      const nonExhaustive = findNonExhaustiveSwitches(overlayProgram, filePath, params.symbol);
      for (const s of nonExhaustive) {
        exhaustivenessImpact.push({
          filePath: s.filePath,
          relativePath: relativePath(s.filePath, engine.workspaceRoot),
          line: s.line,
          missingMembers: s.missingMembers,
        });
      }
    }

    // Step 5: API contract delta — diff the overlay shape vs the current shape
    const contractImpact: SimulationResult['contractImpact'] = [];
    try {
      const baseSf = parseSourceContent(source, filePath);
      const overlayContent = editResult.modifiedSource;
      const overlaySf = parseSourceContent(overlayContent, filePath);

      const baseShapes = extractExports(baseSf).map((e) => extractDeclarationShape(baseSf, e));
      const overlayShapes = extractExports(overlaySf).map((e) => extractDeclarationShape(overlaySf, e));
      const diffs = diffExportSets(baseShapes, overlayShapes);

      for (const d of diffs) {
        const reason = d.diffs.map((dd) => dd.reason).join('; ');
        contractImpact.push({ name: d.name, kind: d.diffs[0]?.kind ?? d.status, risk: d.risk, reason });
      }
    } catch (err) {
      warnings.push(`Contract diff failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Step 6: Semantic diagnostics delta
    const diagnosticsDelta = { newErrors: 0, sample: [] as string[] };
    try {
      const diagnostics = overlayQueries.getSemanticDiagnostics(filePath);
      diagnosticsDelta.newErrors = diagnostics.filter((d) => d.category === 1).length;
      diagnosticsDelta.sample = diagnostics
        .filter((d) => d.category === 1)
        .slice(0, 3)
        .map((d) => `TS${d.code}: ${typeof d.messageText === 'string' ? d.messageText : d.messageText.messageText}`);
    } catch {
      // Diagnostics are best-effort
    }

    // Step 7: Build summary
    const breakCount = breakingCallers.length;
    const exhaustCount = exhaustivenessImpact.length;
    const contractCount = contractImpact.filter((c) => c.risk === 'breaking' || c.risk === 'risky').length;

    let summary: string;
    if (breakCount === 0 && exhaustCount === 0 && contractCount === 0) {
      summary = `Simulated "${recipe.kind}" on "${params.symbol}" — no breaking impact found.`;
    } else {
      const parts = [];
      if (breakCount > 0) parts.push(`${breakCount} breaking caller(s)`);
      if (exhaustCount > 0) parts.push(`${exhaustCount} non-exhaustive switch(es)`);
      if (contractCount > 0) parts.push(`${contractCount} breaking contract change(s)`);
      summary = `Simulated "${recipe.kind}" on "${params.symbol}" — would cause: ${parts.join(', ')}.`;
    }

    return {
      recipe: recipe.kind,
      targetFile: relativePath(filePath, engine.workspaceRoot),
      targetSymbol: params.symbol,
      editDescription: `${editResult.originalSignature} → ${editResult.newSignature}`,
      signatureDiff: { original: editResult.originalSignature, modified: editResult.newSignature },
      breakingCallers,
      compatibleCallerCount,
      contractImpact,
      exhaustivenessImpact,
      diagnosticsDelta,
      summary,
      warnings,
    } satisfies SimulationResult;
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildRecipe(params: any, filePath: string): ChangeRecipe {
  switch (params.recipe) {
    case 'add_required_param':
    case 'add_optional_param':
      return { kind: params.recipe, funcName: params.symbol, filePath, paramName: params.param_name ?? 'newParam', paramType: params.param_type ?? 'unknown' };
    case 'remove_param':
      return { kind: 'remove_param', funcName: params.symbol, filePath, paramName: params.param_name ?? '' };
    case 'add_enum_member':
      return { kind: 'add_enum_member', enumName: params.symbol, filePath, memberName: params.member_name ?? 'NewMember', memberValue: params.member_value };
    case 'remove_enum_member':
      return { kind: 'remove_enum_member', enumName: params.symbol, filePath, memberName: params.member_name ?? '' };
    default:
      return null as any;
  }
}
