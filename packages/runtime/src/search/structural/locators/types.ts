import ts from 'typescript';
import type { QueryIR, StructuralPredicate } from '../../types.js';

export interface LocatedNode {
  node: ts.Node;
  identifier?: string;
  line: number;
}

export interface StructuralLocator {
  kind: 'call' | 'statement' | 'declaration';
  supports(predicates: StructuralPredicate[], ir: QueryIR): boolean;
  locate(sf: ts.SourceFile, ir: QueryIR): LocatedNode[];
}
