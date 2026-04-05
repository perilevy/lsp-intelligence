import type { DeclarationShape } from './extractDeclarationShape.js';

export type DeclRisk = 'breaking' | 'risky' | 'safe';

export interface DeclarationDiff {
  kind:
    | 'added'
    | 'removed'
    | 'renamed'
    | 'param_added'
    | 'param_removed'
    | 'param_required'
    | 'return_type_changed'
    | 'interface_shape_changed'
    | 'enum_member_added'
    | 'enum_member_removed'
    | 'reexport_changed'
    | 'type_changed'
    | 'signature_changed'
    | 'unknown';
  /** Semantic risk level of this change. */
  risk: DeclRisk;
  reason: string;
  details: string[];
}

/**
 * Diff two declaration shapes and return a list of changes.
 */
export function diffDeclarationShapes(
  base: DeclarationShape,
  current: DeclarationShape,
): DeclarationDiff[] {
  const diffs: DeclarationDiff[] = [];

  // Name changed
  if (base.name !== current.name) {
    diffs.push({ kind: 'renamed', risk: 'breaking', reason: `Renamed from "${base.name}" to "${current.name}"`, details: [`base: ${base.name}`, `current: ${current.name}`] });
  }

  // Params changed (functions)
  if (base.params && current.params) {
    // New params (required or optional)
    for (const cp of current.params) {
      const bp = base.params.find((p) => p.name === cp.name);
      if (!bp && !cp.optional) {
        diffs.push({ kind: 'param_required', risk: 'breaking', reason: `New required parameter "${cp.name}"`, details: [`param: ${cp.name}`, `type: ${cp.typeText ?? 'unknown'}`] });
      } else if (!bp && cp.optional) {
        diffs.push({ kind: 'param_added', risk: 'safe', reason: `New optional parameter "${cp.name}"`, details: [`param: ${cp.name}`, `type: ${cp.typeText ?? 'unknown'}`] });
      }
    }
    // Removed params
    for (const bp of base.params) {
      if (!current.params.find((p) => p.name === bp.name)) {
        diffs.push({ kind: 'param_removed', risk: 'breaking', reason: `Parameter "${bp.name}" removed`, details: [`param: ${bp.name}`] });
      }
    }
    // Optional → required
    for (const cp of current.params) {
      const bp = base.params.find((p) => p.name === cp.name);
      if (bp && bp.optional && !cp.optional) {
        diffs.push({ kind: 'param_required', risk: 'breaking', reason: `Parameter "${cp.name}" became required (was optional)`, details: [`param: ${cp.name}`] });
      }
    }
  }

  // Return type changed
  if (base.returnTypeText && current.returnTypeText && base.returnTypeText !== current.returnTypeText) {
    diffs.push({ kind: 'return_type_changed', risk: 'risky', reason: `Return type changed from "${base.returnTypeText}" to "${current.returnTypeText}"`, details: [`base: ${base.returnTypeText}`, `current: ${current.returnTypeText}`] });
  }

  // Interface members changed
  if (base.members && current.members) {
    const baseByName = new Map(base.members.map((m) => [m.name, m]));
    const currentByName = new Map(current.members.map((m) => [m.name, m]));

    for (const [name, cm] of currentByName) {
      const bm = baseByName.get(name);
      if (!bm) {
        if (!cm.optional) {
          diffs.push({ kind: 'interface_shape_changed', risk: 'breaking', reason: `Required interface property "${name}" added — breaking for existing implementations`, details: [`property: ${name}`, `type: ${cm.typeText ?? 'unknown'}`] });
        } else {
          diffs.push({ kind: 'interface_shape_changed', risk: 'risky', reason: `Optional interface property "${name}" added`, details: [`property: ${name}`] });
        }
      } else if (bm.optional && !cm.optional) {
        diffs.push({ kind: 'interface_shape_changed', risk: 'breaking', reason: `Interface property "${name}" became required (was optional)`, details: [`property: ${name}`] });
      }
    }
    for (const [name] of baseByName) {
      if (!currentByName.has(name)) {
        diffs.push({ kind: 'interface_shape_changed', risk: 'breaking', reason: `Interface property "${name}" removed`, details: [`property: ${name}`] });
      }
    }
  }

  // Enum members changed
  if (base.enumMembers && current.enumMembers) {
    const added = current.enumMembers.filter((m) => !base.enumMembers!.includes(m));
    const removed = base.enumMembers.filter((m) => !current.enumMembers!.includes(m));
    for (const m of added) {
      diffs.push({ kind: 'enum_member_added', risk: 'risky', reason: `Enum member "${m}" added — exhaustive handling may be incomplete`, details: [m] });
    }
    for (const m of removed) {
      diffs.push({ kind: 'enum_member_removed', risk: 'breaking', reason: `Enum member "${m}" removed`, details: [m] });
    }
  }

  // Signature text changed (catch-all)
  if (diffs.length === 0 && base.signatureText !== current.signatureText) {
    diffs.push({ kind: 'signature_changed', risk: 'risky', reason: 'Declaration signature changed', details: [`base: ${base.signatureText}`, `current: ${current.signatureText}`] });
  }

  return diffs;
}

export interface ExportSetDiff {
  name: string;
  status: 'added' | 'removed' | 'changed';
  risk: DeclRisk;
  diffs: DeclarationDiff[];
  baseShape?: DeclarationShape;
  currentShape?: DeclarationShape;
}

const RISK_ORDER: Record<DeclRisk, number> = { breaking: 2, risky: 1, safe: 0 };

function worstRisk(diffs: DeclarationDiff[]): DeclRisk {
  return diffs.reduce<DeclRisk>((worst, d) => RISK_ORDER[d.risk] > RISK_ORDER[worst] ? d.risk : worst, 'safe');
}

/**
 * Diff two sets of exports: find added, removed, and changed declarations.
 * Each result includes risk, the originating shapes, and per-change diffs.
 */
export function diffExportSets(
  baseShapes: DeclarationShape[],
  currentShapes: DeclarationShape[],
): ExportSetDiff[] {
  const results: ExportSetDiff[] = [];
  const baseByName = new Map(baseShapes.map((s) => [s.name, s]));
  const currentByName = new Map(currentShapes.map((s) => [s.name, s]));

  for (const [name, baseShape] of baseByName) {
    if (!currentByName.has(name)) {
      results.push({ name, status: 'removed', risk: 'breaking', diffs: [{ kind: 'removed', risk: 'breaking', reason: `Export "${name}" (${baseShape.kind}) was removed`, details: [] }], baseShape });
    }
  }

  for (const [name, currentShape] of currentByName) {
    if (!baseByName.has(name)) {
      results.push({ name, status: 'added', risk: 'safe', diffs: [{ kind: 'added', risk: 'safe', reason: `New export "${name}" (${currentShape.kind})`, details: [] }], currentShape });
    }
  }

  for (const [name, currentShape] of currentByName) {
    const baseShape = baseByName.get(name);
    if (baseShape) {
      const diffs = diffDeclarationShapes(baseShape, currentShape);
      if (diffs.length > 0) {
        results.push({ name, status: 'changed', risk: worstRisk(diffs), diffs, baseShape, currentShape });
      }
    }
  }

  return results;
}
