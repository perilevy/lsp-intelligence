import type { ExportDeclaration } from './extractExportDeclarations.js';

export type ApiChangeKind =
  | 'added'
  | 'removed'
  | 'modified'
  | 'renamed'
  | 'enum_member_added'
  | 'enum_member_removed'
  | 'param_required'
  | 'param_added'
  | 'param_removed'
  | 'return_type_changed'
  | 'interface_shape_changed'
  | 'type_changed'
  | 'reexport_changed';

export type ApiRiskLevel = 'breaking' | 'risky' | 'safe';

export interface DeclDiff {
  name: string;
  kind: ApiChangeKind;
  risk: ApiRiskLevel;
  reason: string;
  structuralDiff: string[];
  baseDecl?: ExportDeclaration;
  currentDecl?: ExportDeclaration;
}

/**
 * Diff two sets of export declarations. Returns classified changes.
 */
export function diffExportDeclarations(
  baseExports: ExportDeclaration[],
  currentExports: ExportDeclaration[],
): DeclDiff[] {
  const diffs: DeclDiff[] = [];
  const baseMap = new Map(baseExports.map((e) => [e.name, e]));
  const currentMap = new Map(currentExports.map((e) => [e.name, e]));

  // Removed exports
  for (const [name, base] of baseMap) {
    if (!currentMap.has(name)) {
      diffs.push({
        name,
        kind: 'removed',
        risk: 'breaking',
        reason: `Export "${name}" (${base.declarationKind}) was removed`,
        structuralDiff: [`- ${base.signatureText.substring(0, 100)}`],
        baseDecl: base,
      });
    }
  }

  // Added exports
  for (const [name, current] of currentMap) {
    if (!baseMap.has(name)) {
      diffs.push({
        name,
        kind: 'added',
        risk: 'safe',
        reason: `New export "${name}" (${current.declarationKind})`,
        structuralDiff: [`+ ${current.signatureText.substring(0, 100)}`],
        currentDecl: current,
      });
    }
  }

  // Modified exports
  for (const [name, current] of currentMap) {
    const base = baseMap.get(name);
    if (!base) continue;

    const changes = compareDeclarations(base, current);
    if (changes.length > 0) {
      const worstRisk = changes.reduce((worst, c) => {
        if (c.risk === 'breaking') return 'breaking';
        if (c.risk === 'risky' && worst !== 'breaking') return 'risky';
        return worst;
      }, 'safe' as ApiRiskLevel);

      diffs.push({
        name,
        kind: changes[0].kind,
        risk: worstRisk,
        reason: changes.map((c) => c.reason).join('; '),
        structuralDiff: changes.flatMap((c) => c.diffs),
        baseDecl: base,
        currentDecl: current,
      });
    }
  }

  return diffs;
}

interface ChangeDetail {
  kind: ApiChangeKind;
  risk: ApiRiskLevel;
  reason: string;
  diffs: string[];
}

function compareDeclarations(base: ExportDeclaration, current: ExportDeclaration): ChangeDetail[] {
  const changes: ChangeDetail[] = [];

  // Enum member comparison
  if (base.declarationKind === 'enum' && current.declarationKind === 'enum') {
    const baseMembers = new Set(base.members ?? []);
    const currentMembers = new Set(current.members ?? []);

    for (const m of currentMembers) {
      if (!baseMembers.has(m)) {
        changes.push({
          kind: 'enum_member_added',
          risk: 'risky',
          reason: `Enum member "${m}" added — exhaustive handling may be incomplete`,
          diffs: [`+ ${m}`],
        });
      }
    }
    for (const m of baseMembers) {
      if (!currentMembers.has(m)) {
        changes.push({
          kind: 'enum_member_removed',
          risk: 'breaking',
          reason: `Enum member "${m}" removed`,
          diffs: [`- ${m}`],
        });
      }
    }
    return changes;
  }

  // Interface member comparison
  if (base.declarationKind === 'interface' && current.declarationKind === 'interface') {
    const baseMembers = new Set(base.members ?? []);
    const currentMembers = new Set(current.members ?? []);

    for (const m of baseMembers) {
      if (!currentMembers.has(m)) {
        changes.push({
          kind: 'interface_shape_changed',
          risk: 'breaking',
          reason: `Interface property "${m}" removed`,
          diffs: [`- ${m}`],
        });
      }
    }
    for (const m of currentMembers) {
      if (!baseMembers.has(m)) {
        changes.push({
          kind: 'interface_shape_changed',
          risk: 'risky',
          reason: `Interface property "${m}" added`,
          diffs: [`+ ${m}`],
        });
      }
    }
    return changes;
  }

  // Function parameter comparison
  if (base.declarationKind === 'function' && current.declarationKind === 'function') {
    const baseParams = base.params ?? [];
    const currentParams = current.params ?? [];

    if (currentParams.length > baseParams.length) {
      const added = currentParams.slice(baseParams.length);
      for (const p of added) {
        changes.push({
          kind: p.optional ? 'param_added' : 'param_required',
          risk: p.optional ? 'safe' : 'breaking',
          reason: p.optional
            ? `Optional parameter "${p.name}" added`
            : `Required parameter "${p.name}" added`,
          diffs: [`+ ${p.name}${p.optional ? '?' : ''}: ${p.type ?? 'unknown'}`],
        });
      }
    }
    if (currentParams.length < baseParams.length) {
      const removed = baseParams.slice(currentParams.length);
      for (const p of removed) {
        changes.push({
          kind: 'param_removed',
          risk: 'breaking',
          reason: `Parameter "${p.name}" removed`,
          diffs: [`- ${p.name}: ${p.type ?? 'unknown'}`],
        });
      }
    }

    // Check optionality changes
    for (let i = 0; i < Math.min(baseParams.length, currentParams.length); i++) {
      if (baseParams[i].optional && !currentParams[i].optional) {
        changes.push({
          kind: 'param_required',
          risk: 'breaking',
          reason: `Parameter "${currentParams[i].name}" became required (was optional)`,
          diffs: [`~ ${currentParams[i].name}?: → ${currentParams[i].name}:`],
        });
      }
    }

    // Return type change
    if (base.returnType && current.returnType && base.returnType !== current.returnType) {
      changes.push({
        kind: 'return_type_changed',
        risk: 'risky',
        reason: `Return type changed: ${base.returnType} → ${current.returnType}`,
        diffs: [`- returns: ${base.returnType}`, `+ returns: ${current.returnType}`],
      });
    }

    return changes;
  }

  // Generic signature comparison (fallback)
  if (base.signatureText !== current.signatureText) {
    changes.push({
      kind: 'modified',
      risk: 'risky',
      reason: `Declaration signature changed`,
      diffs: [
        `- ${base.signatureText.substring(0, 100)}`,
        `+ ${current.signatureText.substring(0, 100)}`,
      ],
    });
  }

  return changes;
}
