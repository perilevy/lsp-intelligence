import type { DeclarationShape } from './extractDeclarationShape.js';

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
    diffs.push({
      kind: 'renamed',
      reason: `Renamed from "${base.name}" to "${current.name}"`,
      details: [`base: ${base.name}`, `current: ${current.name}`],
    });
  }

  // Params changed (functions)
  if (base.params && current.params) {
    // New required params
    for (const cp of current.params) {
      const bp = base.params.find((p) => p.name === cp.name);
      if (!bp && !cp.optional) {
        diffs.push({
          kind: 'param_required',
          reason: `New required parameter "${cp.name}"`,
          details: [`param: ${cp.name}`, `type: ${cp.typeText ?? 'unknown'}`],
        });
      } else if (!bp && cp.optional) {
        diffs.push({
          kind: 'param_added',
          reason: `New optional parameter "${cp.name}"`,
          details: [`param: ${cp.name}`, `type: ${cp.typeText ?? 'unknown'}`],
        });
      }
    }
    // Removed params
    for (const bp of base.params) {
      if (!current.params.find((p) => p.name === bp.name)) {
        diffs.push({
          kind: 'param_removed',
          reason: `Removed parameter "${bp.name}"`,
          details: [`param: ${bp.name}`],
        });
      }
    }
    // Optional → required
    for (const cp of current.params) {
      const bp = base.params.find((p) => p.name === cp.name);
      if (bp && bp.optional && !cp.optional) {
        diffs.push({
          kind: 'param_required',
          reason: `Parameter "${cp.name}" changed from optional to required`,
          details: [`param: ${cp.name}`],
        });
      }
    }
  }

  // Return type changed
  if (base.returnTypeText && current.returnTypeText && base.returnTypeText !== current.returnTypeText) {
    diffs.push({
      kind: 'return_type_changed',
      reason: `Return type changed from "${base.returnTypeText}" to "${current.returnTypeText}"`,
      details: [`base: ${base.returnTypeText}`, `current: ${current.returnTypeText}`],
    });
  }

  // Interface members changed
  if (base.members && current.members) {
    for (const cm of current.members) {
      const bm = base.members.find((m) => m.name === cm.name);
      if (!bm && !cm.optional) {
        diffs.push({
          kind: 'interface_shape_changed',
          reason: `New required member "${cm.name}"`,
          details: [`member: ${cm.name}`, `type: ${cm.typeText ?? 'unknown'}`],
        });
      }
    }
    for (const bm of base.members) {
      if (!current.members.find((m) => m.name === bm.name)) {
        diffs.push({
          kind: 'interface_shape_changed',
          reason: `Removed member "${bm.name}"`,
          details: [`member: ${bm.name}`],
        });
      }
    }
  }

  // Enum members changed
  if (base.enumMembers && current.enumMembers) {
    const added = current.enumMembers.filter((m) => !base.enumMembers!.includes(m));
    const removed = base.enumMembers.filter((m) => !current.enumMembers!.includes(m));
    for (const m of added) {
      diffs.push({ kind: 'enum_member_added', reason: `Enum member added: "${m}"`, details: [m] });
    }
    for (const m of removed) {
      diffs.push({ kind: 'enum_member_removed', reason: `Enum member removed: "${m}"`, details: [m] });
    }
  }

  // Signature text changed (catch-all)
  if (diffs.length === 0 && base.signatureText !== current.signatureText) {
    diffs.push({
      kind: 'signature_changed',
      reason: 'Declaration signature changed',
      details: [`base: ${base.signatureText}`, `current: ${current.signatureText}`],
    });
  }

  return diffs;
}

/**
 * Diff two sets of exports: find added, removed, and changed declarations.
 */
export function diffExportSets(
  baseShapes: DeclarationShape[],
  currentShapes: DeclarationShape[],
): Array<{ name: string; status: 'added' | 'removed' | 'changed'; diffs: DeclarationDiff[] }> {
  const results: Array<{ name: string; status: 'added' | 'removed' | 'changed'; diffs: DeclarationDiff[] }> = [];

  const baseByName = new Map(baseShapes.map((s) => [s.name, s]));
  const currentByName = new Map(currentShapes.map((s) => [s.name, s]));

  // Removed
  for (const [name, shape] of baseByName) {
    if (!currentByName.has(name)) {
      results.push({ name, status: 'removed', diffs: [{ kind: 'removed', reason: `Export "${name}" removed`, details: [] }] });
    }
  }

  // Added
  for (const [name, shape] of currentByName) {
    if (!baseByName.has(name)) {
      results.push({ name, status: 'added', diffs: [{ kind: 'added', reason: `Export "${name}" added`, details: [] }] });
    }
  }

  // Changed
  for (const [name, currentShape] of currentByName) {
    const baseShape = baseByName.get(name);
    if (baseShape) {
      const diffs = diffDeclarationShapes(baseShape, currentShape);
      if (diffs.length > 0) {
        results.push({ name, status: 'changed', diffs });
      }
    }
  }

  return results;
}
