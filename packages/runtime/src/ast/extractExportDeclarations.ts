import type { SgNode } from '@ast-grep/napi';

export interface ExportDeclaration {
  name: string;
  declarationKind: 'function' | 'type' | 'interface' | 'enum' | 'class' | 'const' | 'variable' | 'reexport' | 'unknown';
  line: number;
  signatureText: string;
  members?: string[];
  params?: ParamInfo[];
  returnType?: string;
}

export interface ParamInfo {
  name: string;
  type?: string;
  optional: boolean;
}

/**
 * AST-first export extraction with regex fallback for unsupported forms.
 * When root is provided (non-null), uses ast-grep traversal.
 * When root is null, falls back to regex over source lines.
 */
export function extractExportDeclarations(root: SgNode | null, source: string): ExportDeclaration[] {
  if (root) {
    return extractWithAst(root, source);
  }
  return extractWithRegex(source);
}

// --- AST-based extraction ---

function extractWithAst(root: SgNode, source: string): ExportDeclaration[] {
  const exports: ExportDeclaration[] = [];
  const lines = source.split('\n');
  const seen = new Set<string>();

  // Find all exported declarations using ast-grep patterns
  const patterns = [
    { pattern: 'export function $NAME($$$) { $$$ }', kind: 'function' as const },
    { pattern: 'export async function $NAME($$$) { $$$ }', kind: 'function' as const },
    { pattern: 'export const $NAME = $$$', kind: 'const' as const },
    { pattern: 'export let $NAME = $$$', kind: 'variable' as const },
    { pattern: 'export interface $NAME { $$$ }', kind: 'interface' as const },
    { pattern: 'export type $NAME = $$$', kind: 'type' as const },
    { pattern: 'export enum $NAME { $$$ }', kind: 'enum' as const },
    { pattern: 'export class $NAME { $$$ }', kind: 'class' as const },
    { pattern: 'export abstract class $NAME { $$$ }', kind: 'class' as const },
    { pattern: 'export default function $NAME($$$) { $$$ }', kind: 'function' as const },
  ];

  for (const { pattern, kind } of patterns) {
    try {
      const matches = root.findAll(pattern);
      for (const match of matches) {
        const nameNode = match.getMatch('NAME');
        if (!nameNode) continue;
        const name = nameNode.text();
        if (seen.has(name)) continue;
        seen.add(name);

        const range = match.range();
        const line1 = range.start.line + 1;
        const sigText = match.text().substring(0, 200);

        const decl: ExportDeclaration = {
          name,
          declarationKind: kind,
          line: line1,
          signatureText: sigText,
        };

        // Enrich based on kind
        if (kind === 'function') {
          decl.params = extractParamsFromText(sigText);
          decl.returnType = extractReturnTypeFromText(sigText);
          // Check if const is actually a function (arrow/function expression)
        } else if (kind === 'const') {
          // Detect if this is actually a function (arrow or function expression)
          if (sigText.match(/=\s*(?:async\s+)?(?:\(|function)/)) {
            decl.declarationKind = 'function';
            decl.params = extractParamsFromText(sigText);
            decl.returnType = extractReturnTypeFromText(sigText);
          }
        } else if (kind === 'enum' || kind === 'interface') {
          decl.members = extractBlockMembersFromLines(lines, range.start.line);
        }

        exports.push(decl);
      }
    } catch {
      // Pattern may not match — continue with other patterns
    }
  }

  // AST may miss re-exports and barrel exports — use regex for those
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // export { name1, name2 } from "module"
    const reexportMatch = line.match(/export\s+\{([^}]+)\}\s+from\s+['"]/);
    if (reexportMatch) {
      const names = reexportMatch[1].split(',').map((n) => n.trim().split(/\s+as\s+/)[0].trim());
      for (const name of names) {
        if (name && !seen.has(name)) {
          seen.add(name);
          exports.push({ name, declarationKind: 'reexport', line: i + 1, signatureText: line.trim() });
        }
      }
    }

    // export * from "module"
    const barrelMatch = line.match(/export\s+\*\s+from\s+['"]([^'"]+)['"]/);
    if (barrelMatch && !seen.has(`*${barrelMatch[1]}`)) {
      seen.add(`*${barrelMatch[1]}`);
      exports.push({ name: `* from "${barrelMatch[1]}"`, declarationKind: 'reexport', line: i + 1, signatureText: line.trim() });
    }

    // export type { X } from "module"
    const typeReexport = line.match(/export\s+type\s+\{([^}]+)\}\s+from\s+['"]/);
    if (typeReexport) {
      const names = typeReexport[1].split(',').map((n) => n.trim().split(/\s+as\s+/)[0].trim());
      for (const name of names) {
        if (name && !seen.has(name)) {
          seen.add(name);
          exports.push({ name, declarationKind: 'reexport', line: i + 1, signatureText: line.trim() });
        }
      }
    }
  }

  return exports;
}

// --- Regex fallback (used when AST root is null) ---

function extractWithRegex(source: string): ExportDeclaration[] {
  const exports: ExportDeclaration[] = [];
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('export')) continue;

    const funcMatch = line.match(/export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/);
    if (funcMatch) {
      const sig = extractFuncSigFromLines(lines, i);
      exports.push({ name: funcMatch[1], declarationKind: 'function', line: i + 1, signatureText: sig.text, params: sig.params, returnType: sig.returnType });
      continue;
    }

    const constFuncMatch = line.match(/export\s+const\s+(\w+)\s*=\s*(?:async\s+)?(?:\(|function)/);
    if (constFuncMatch) {
      const sig = extractFuncSigFromLines(lines, i);
      exports.push({ name: constFuncMatch[1], declarationKind: 'function', line: i + 1, signatureText: sig.text, params: sig.params, returnType: sig.returnType });
      continue;
    }

    const constMatch = line.match(/export\s+(?:const|let|var)\s+(\w+)/);
    if (constMatch && !constFuncMatch) {
      exports.push({ name: constMatch[1], declarationKind: 'const', line: i + 1, signatureText: line.trim().substring(0, 150) });
      continue;
    }

    const ifaceMatch = line.match(/export\s+interface\s+(\w+)/);
    if (ifaceMatch) {
      exports.push({ name: ifaceMatch[1], declarationKind: 'interface', line: i + 1, signatureText: line.trim(), members: extractBlockMembersFromLines(lines, i) });
      continue;
    }

    const typeMatch = line.match(/export\s+type\s+(\w+)/);
    if (typeMatch) {
      exports.push({ name: typeMatch[1], declarationKind: 'type', line: i + 1, signatureText: line.trim().substring(0, 150) });
      continue;
    }

    const enumMatch = line.match(/export\s+enum\s+(\w+)/);
    if (enumMatch) {
      exports.push({ name: enumMatch[1], declarationKind: 'enum', line: i + 1, signatureText: line.trim(), members: extractBlockMembersFromLines(lines, i) });
      continue;
    }

    const classMatch = line.match(/export\s+(?:abstract\s+)?class\s+(\w+)/);
    if (classMatch) {
      exports.push({ name: classMatch[1], declarationKind: 'class', line: i + 1, signatureText: line.trim().substring(0, 150) });
      continue;
    }

    const reexportMatch = line.match(/export\s+\{([^}]+)\}\s+from\s+['"]/);
    if (reexportMatch) {
      for (const name of reexportMatch[1].split(',').map((n) => n.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean)) {
        exports.push({ name, declarationKind: 'reexport', line: i + 1, signatureText: line.trim() });
      }
      continue;
    }

    const barrelMatch = line.match(/export\s+\*\s+from\s+['"]([^'"]+)['"]/);
    if (barrelMatch) {
      exports.push({ name: `* from "${barrelMatch[1]}"`, declarationKind: 'reexport', line: i + 1, signatureText: line.trim() });
    }
  }

  return exports;
}

// --- Shared helpers ---

function extractParamsFromText(text: string): ParamInfo[] {
  const paramMatch = text.match(/\(([^)]*)\)/);
  if (!paramMatch) return [];
  const params: ParamInfo[] = [];
  for (const p of paramMatch[1].split(',')) {
    const trimmed = p.trim();
    if (!trimmed) continue;
    const optional = trimmed.includes('?');
    const name = trimmed.split(/[?:]/)[0].trim();
    const typeMatch = trimmed.match(/:\s*(.+)/);
    params.push({ name, type: typeMatch?.[1]?.trim(), optional });
  }
  return params;
}

function extractReturnTypeFromText(text: string): string | undefined {
  const returnMatch = text.match(/\)\s*:\s*([^{=>]+)/);
  return returnMatch?.[1]?.trim();
}

function extractBlockMembersFromLines(lines: string[], startLine: number): string[] {
  const members: string[] = [];
  let braceCount = 0;
  let started = false;
  for (let i = startLine; i < Math.min(startLine + 50, lines.length); i++) {
    if (lines[i].includes('{')) { started = true; braceCount++; }
    if (lines[i].includes('}')) braceCount--;
    if (started && braceCount > 0) {
      const memberMatch = lines[i].trim().match(/^(\w+)\s*[?:=,]/);
      if (memberMatch && memberMatch[1] !== 'export') members.push(memberMatch[1]);
    }
    if (started && braceCount === 0) break;
  }
  return members;
}

function extractFuncSigFromLines(lines: string[], startLine: number): { text: string; params: ParamInfo[]; returnType?: string } {
  let sig = '';
  for (let i = startLine; i < Math.min(startLine + 10, lines.length); i++) {
    sig += lines[i] + '\n';
    if (lines[i].includes('{') || lines[i].includes('=>')) break;
  }
  return { text: sig.trim().substring(0, 200), params: extractParamsFromText(sig), returnType: extractReturnTypeFromText(sig) };
}
