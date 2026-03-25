export interface ExportDeclaration {
  name: string;
  declarationKind: 'function' | 'type' | 'interface' | 'enum' | 'class' | 'const' | 'variable' | 'reexport' | 'unknown';
  line: number;
  signatureText: string;
  members?: string[];  // For enums, interfaces: member names
  params?: ParamInfo[];  // For functions: param info
  returnType?: string;
}

export interface ParamInfo {
  name: string;
  type?: string;
  optional: boolean;
}

/**
 * Extract all export declarations from an AST root.
 */
export function extractExportDeclarations(root: unknown, source: string): ExportDeclaration[] {
  const exports: ExportDeclaration[] = [];
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('export')) continue;

    // export function name(...)
    const funcMatch = line.match(/export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/);
    if (funcMatch) {
      const sig = extractFunctionSignature(lines, i);
      exports.push({
        name: funcMatch[1],
        declarationKind: 'function',
        line: i + 1,
        signatureText: sig.text,
        params: sig.params,
        returnType: sig.returnType,
      });
      continue;
    }

    // export const name = (...) => ... or export const name = function
    const constFuncMatch = line.match(/export\s+const\s+(\w+)\s*=\s*(?:async\s+)?(?:\(|function)/);
    if (constFuncMatch) {
      const sig = extractFunctionSignature(lines, i);
      exports.push({
        name: constFuncMatch[1],
        declarationKind: 'function',
        line: i + 1,
        signatureText: sig.text,
        params: sig.params,
        returnType: sig.returnType,
      });
      continue;
    }

    // export const/let/var name
    const constMatch = line.match(/export\s+(?:const|let|var)\s+(\w+)/);
    if (constMatch && !constFuncMatch) {
      exports.push({
        name: constMatch[1],
        declarationKind: 'const',
        line: i + 1,
        signatureText: line.trim().substring(0, 150),
      });
      continue;
    }

    // export interface name { ... }
    const ifaceMatch = line.match(/export\s+interface\s+(\w+)/);
    if (ifaceMatch) {
      const members = extractBlockMembers(lines, i);
      exports.push({
        name: ifaceMatch[1],
        declarationKind: 'interface',
        line: i + 1,
        signatureText: line.trim(),
        members,
      });
      continue;
    }

    // export type name = ...
    const typeMatch = line.match(/export\s+type\s+(\w+)/);
    if (typeMatch) {
      exports.push({
        name: typeMatch[1],
        declarationKind: 'type',
        line: i + 1,
        signatureText: line.trim().substring(0, 150),
      });
      continue;
    }

    // export enum name { ... }
    const enumMatch = line.match(/export\s+enum\s+(\w+)/);
    if (enumMatch) {
      const members = extractBlockMembers(lines, i);
      exports.push({
        name: enumMatch[1],
        declarationKind: 'enum',
        line: i + 1,
        signatureText: line.trim(),
        members,
      });
      continue;
    }

    // export class name
    const classMatch = line.match(/export\s+(?:abstract\s+)?class\s+(\w+)/);
    if (classMatch) {
      exports.push({
        name: classMatch[1],
        declarationKind: 'class',
        line: i + 1,
        signatureText: line.trim().substring(0, 150),
      });
      continue;
    }

    // export { name1, name2 } from "module"
    const reexportMatch = line.match(/export\s+\{([^}]+)\}\s+from\s+['"]/);
    if (reexportMatch) {
      const names = reexportMatch[1].split(',').map((n) => n.trim().split(/\s+as\s+/)[0].trim());
      for (const name of names) {
        if (name) {
          exports.push({
            name,
            declarationKind: 'reexport',
            line: i + 1,
            signatureText: line.trim(),
          });
        }
      }
      continue;
    }

    // export * from "module"
    const barrelMatch = line.match(/export\s+\*\s+from\s+['"]([^'"]+)['"]/);
    if (barrelMatch) {
      exports.push({
        name: `* from "${barrelMatch[1]}"`,
        declarationKind: 'reexport',
        line: i + 1,
        signatureText: line.trim(),
      });
    }
  }

  return exports;
}

function extractFunctionSignature(lines: string[], startLine: number): {
  text: string;
  params: ParamInfo[];
  returnType?: string;
} {
  // Collect lines until we find the opening brace or arrow
  let sig = '';
  for (let i = startLine; i < Math.min(startLine + 10, lines.length); i++) {
    sig += lines[i] + '\n';
    if (lines[i].includes('{') || lines[i].includes('=>')) break;
  }

  // Extract params
  const paramMatch = sig.match(/\(([^)]*)\)/);
  const params: ParamInfo[] = [];
  if (paramMatch) {
    const paramStr = paramMatch[1];
    for (const p of paramStr.split(',')) {
      const trimmed = p.trim();
      if (!trimmed) continue;
      const optional = trimmed.includes('?');
      const name = trimmed.split(/[?:]/)[0].trim();
      const typeMatch = trimmed.match(/:\s*(.+)/);
      params.push({ name, type: typeMatch?.[1]?.trim(), optional });
    }
  }

  // Extract return type
  const returnMatch = sig.match(/\)\s*:\s*([^{=>]+)/);
  const returnType = returnMatch?.[1]?.trim();

  return { text: sig.trim().substring(0, 200), params, returnType };
}

function extractBlockMembers(lines: string[], startLine: number): string[] {
  const members: string[] = [];
  let braceCount = 0;
  let started = false;

  for (let i = startLine; i < Math.min(startLine + 50, lines.length); i++) {
    const line = lines[i];
    if (line.includes('{')) { started = true; braceCount++; }
    if (line.includes('}')) braceCount--;

    if (started && braceCount > 0) {
      // Extract member name (before : or = or ,)
      const memberMatch = line.trim().match(/^(\w+)\s*[?:=,]/);
      if (memberMatch && memberMatch[1] !== 'export') {
        members.push(memberMatch[1]);
      }
    }
    if (started && braceCount === 0) break;
  }

  return members;
}
