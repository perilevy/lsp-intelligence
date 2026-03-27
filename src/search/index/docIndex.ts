import ts from 'typescript';
import type { DocIndexEntry } from '../types.js';

/**
 * Extract doc/narrative entries from a TypeScript source file.
 * Indexes: JSDoc on exported declarations, leading comments, describe/it/test titles.
 */
export function indexFileDocs(sf: ts.SourceFile): DocIndexEntry[] {
  const entries: DocIndexEntry[] = [];
  const filePath = sf.fileName;

  function visit(node: ts.Node) {
    // JSDoc on exported declarations
    if (isExportedDeclaration(node)) {
      const name = getDeclarationName(node);
      const jsdoc = getJSDocText(node, sf);
      if (jsdoc) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        entries.push({
          filePath,
          line,
          kind: 'jsdoc',
          text: jsdoc,
          tokens: tokenize(jsdoc),
          attachedSymbol: name,
        });
      }

      // Leading comment (non-JSDoc) above exported declarations
      const leadingComment = getLeadingComment(node, sf);
      if (leadingComment && leadingComment !== jsdoc) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        entries.push({
          filePath,
          line,
          kind: 'comment',
          text: leadingComment,
          tokens: tokenize(leadingComment),
          attachedSymbol: name,
        });
      }
    }

    // Test titles: describe('...'), it('...'), test('...')
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const callee = node.expression.text;
      if ((callee === 'describe' || callee === 'it' || callee === 'test') && node.arguments.length > 0) {
        const firstArg = node.arguments[0];
        if (ts.isStringLiteral(firstArg) || ts.isNoSubstitutionTemplateLiteral(firstArg)) {
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          entries.push({
            filePath,
            line,
            kind: 'test-title',
            text: firstArg.text,
            tokens: tokenize(firstArg.text),
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);
  return entries;
}

function isExportedDeclaration(node: ts.Node): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  if (!mods) return false;
  return mods.some((m: ts.Modifier) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function getDeclarationName(node: ts.Node): string | undefined {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (ts.isClassDeclaration(node) && node.name) return node.name.text;
  if (ts.isVariableStatement(node)) {
    for (const decl of node.declarationList.declarations) {
      if (ts.isIdentifier(decl.name)) return decl.name.text;
    }
  }
  if (ts.isInterfaceDeclaration(node)) return node.name.text;
  if (ts.isTypeAliasDeclaration(node)) return node.name.text;
  if (ts.isEnumDeclaration(node)) return node.name.text;
  return undefined;
}

function getJSDocText(node: ts.Node, sf: ts.SourceFile): string | undefined {
  const jsdocs = (node as any).jsDoc as ts.JSDoc[] | undefined;
  if (!jsdocs || jsdocs.length === 0) return undefined;
  const comment = jsdocs[0].comment;
  if (typeof comment === 'string') return comment;
  if (Array.isArray(comment)) return comment.map((c: any) => c.text ?? '').join('');
  return undefined;
}

function getLeadingComment(node: ts.Node, sf: ts.SourceFile): string | undefined {
  const fullText = sf.getFullText();
  const ranges = ts.getLeadingCommentRanges(fullText, node.getFullStart());
  if (!ranges || ranges.length === 0) return undefined;

  // Take last comment before the node
  const range = ranges[ranges.length - 1];
  let text = fullText.substring(range.pos, range.end);

  // Strip comment markers
  text = text.replace(/^\/\*\*?\s*|\s*\*\/$/g, '').replace(/^\s*\/\/\s*/gm, '').replace(/^\s*\*\s?/gm, '').trim();
  return text || undefined;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}
