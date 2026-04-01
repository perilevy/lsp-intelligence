import type { SgNode } from '@ast-grep/napi';

/**
 * Find the smallest AST node covering a given line (0-indexed).
 */
export function findNodeAtLine(root: SgNode, line0: number): { node: SgNode; kind: string } | null {
  let best: SgNode | null = null;
  let bestSize = Infinity;

  const walk = (node: SgNode) => {
    const range = node.range();
    if (range.start.line <= line0 && range.end.line >= line0) {
      const size = range.end.line - range.start.line;
      if (size < bestSize) {
        best = node;
        bestSize = size;
      }
      for (const child of node.children()) {
        walk(child);
      }
    }
  };

  walk(root);
  if (!best) return null;
  return { node: best, kind: classifyNodeKind(best) };
}

function classifyNodeKind(node: SgNode): string {
  const kind = String(node.kind());
  if (kind.includes('call')) return 'call_expression';
  if (kind.includes('member') || kind.includes('property_access')) return 'property_access';
  if (kind.includes('variable') || kind.includes('lexical')) return 'variable_declaration';
  if (kind.includes('return')) return 'return_statement';
  if (kind.includes('switch')) return 'switch_case';
  if (kind.includes('object')) return 'object_literal';
  if (kind.includes('function') || kind.includes('arrow')) return 'function';
  if (kind.includes('class')) return 'class';
  if (kind.includes('if')) return 'conditional';
  if (kind.includes('import')) return 'import';
  if (kind.includes('export')) return 'export';
  return kind;
}

/**
 * Classify the error site based on the enclosing AST node.
 */
export function classifyErrorSite(root: SgNode, line0: number): string | null {
  const result = findNodeAtLine(root, line0);
  if (!result) return null;

  const { kind } = result;
  if (kind === 'call_expression') return 'bad_call_argument';
  if (kind === 'property_access') return 'missing_property_access';
  if (kind === 'switch_case') return 'unhandled_enum_member';
  if (kind === 'import') return 'bad_import_usage';
  if (kind === 'return_statement') return 'wrong_return_type';
  if (kind === 'variable_declaration') return 'incompatible_assignment';
  if (kind === 'object_literal') return 'missing_object_property';
  return kind;
}
