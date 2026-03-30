import ts from 'typescript';
import * as path from 'path';
import type { RouteIndexEntry } from '../../search/types.js';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all', 'use']);
const NEXT_HANDLER_NAMES = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);

/**
 * Extract route definitions from a TypeScript/JavaScript source file.
 *
 * Supports:
 * - Express/Fastify: app.get('/path', handler), router.post(...)
 * - Next.js App Router: exported GET/POST/etc in route.ts files
 * - Next.js Pages API: default export in pages/api/** files
 * - Route maps: object literals with path/method/handler fields
 */
export function extractRoutes(sf: ts.SourceFile): RouteIndexEntry[] {
  const entries: RouteIndexEntry[] = [];
  const filePath = sf.fileName;
  const basename = path.basename(filePath, path.extname(filePath));
  const isRouteFile = basename === 'route';
  const isPagesApi = filePath.includes('/pages/api/') || filePath.includes('/pages\\api\\');

  function visit(node: ts.Node) {
    // A. Express/Fastify-style: app.get('/path', handler)
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text.toLowerCase();
      if (HTTP_METHODS.has(method) && node.arguments.length >= 1) {
        const firstArg = node.arguments[0];
        if (ts.isStringLiteral(firstArg) || ts.isNoSubstitutionTemplateLiteral(firstArg)) {
          const routePath = firstArg.text;
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          const callee = getCalleeText(node.expression.expression);
          entries.push({
            filePath, line,
            method: method === 'use' ? undefined : method.toUpperCase(),
            path: routePath,
            framework: callee?.includes('fastify') ? 'fastify' : 'express',
            enclosingSymbol: callee,
            tokens: tokenize(`${method} ${routePath} ${callee ?? ''}`),
            text: `${method.toUpperCase()} ${routePath}`,
          });
        }
      }
    }

    // B. Fastify route({ method, url, handler })
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      if (node.expression.name.text === 'route' && node.arguments.length >= 1) {
        const arg = node.arguments[0];
        if (ts.isObjectLiteralExpression(arg)) {
          const method = getPropertyValue(arg, 'method');
          const url = getPropertyValue(arg, 'url');
          if (method && url) {
            const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
            entries.push({
              filePath, line,
              method: method.toUpperCase(),
              path: url,
              framework: 'fastify',
              tokens: tokenize(`${method} ${url} route`),
              text: `${method.toUpperCase()} ${url}`,
            });
          }
        }
      }
    }

    // C. Next.js App Router: exported GET, POST, etc. in route.ts
    if (isRouteFile && isExportedNamedDeclaration(node)) {
      const name = getExportedName(node);
      if (name && NEXT_HANDLER_NAMES.has(name)) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        const routePath = deriveRouteFromFilePath(filePath);
        entries.push({
          filePath, line,
          method: name,
          path: routePath,
          framework: 'next-app-router',
          enclosingSymbol: name,
          tokens: tokenize(`${name} ${routePath ?? ''} next handler`),
          text: `${name} ${routePath ?? filePath}`,
        });
      }
    }

    // D. Next.js Pages API: default export in pages/api/**
    if (isPagesApi && ts.isExportAssignment(node)) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      const routePath = deriveRouteFromFilePath(filePath);
      entries.push({
        filePath, line,
        path: routePath,
        framework: 'next-pages-api',
        tokens: tokenize(`${routePath ?? ''} api handler pages`),
        text: `handler ${routePath ?? filePath}`,
      });
    }

    // E. Route map: object with path/route/method/handler keys
    if (ts.isObjectLiteralExpression(node) && node.properties.length >= 2) {
      const hasPath = hasProperty(node, 'path') || hasProperty(node, 'route');
      const hasHandler = hasProperty(node, 'handler') || hasProperty(node, 'component') || hasProperty(node, 'action');
      if (hasPath && hasHandler) {
        const routePath = getPropertyValue(node, 'path') ?? getPropertyValue(node, 'route');
        const method = getPropertyValue(node, 'method');
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        entries.push({
          filePath, line,
          method: method?.toUpperCase(),
          path: routePath,
          framework: 'route-map',
          tokens: tokenize(`${method ?? ''} ${routePath ?? ''} route map`),
          text: `${method?.toUpperCase() ?? 'ROUTE'} ${routePath ?? '?'}`,
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);
  return entries;
}

function getCalleeText(expr: ts.Expression): string | undefined {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return getCalleeText(expr.expression);
  return undefined;
}

function isExportedNamedDeclaration(node: ts.Node): boolean {
  if (ts.isFunctionDeclaration(node) || ts.isVariableStatement(node)) {
    const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    return mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  }
  return false;
}

function getExportedName(node: ts.Node): string | undefined {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (ts.isVariableStatement(node)) {
    for (const decl of node.declarationList.declarations) {
      if (ts.isIdentifier(decl.name)) return decl.name.text;
    }
  }
  return undefined;
}

function hasProperty(obj: ts.ObjectLiteralExpression, name: string): boolean {
  return obj.properties.some((p) =>
    ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === name);
}

function getPropertyValue(obj: ts.ObjectLiteralExpression, name: string): string | undefined {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === name) {
      if (ts.isStringLiteral(p.initializer)) return p.initializer.text;
    }
  }
  return undefined;
}

function deriveRouteFromFilePath(filePath: string): string | undefined {
  // Next.js: derive /api/foo from pages/api/foo.ts or app/api/foo/route.ts
  const pagesMatch = filePath.match(/pages[/\\]api[/\\](.+?)(?:\/index)?\.\w+$/);
  if (pagesMatch) return `/api/${pagesMatch[1].replace(/\\/g, '/')}`;
  const appMatch = filePath.match(/app[/\\](.+?)[/\\]route\.\w+$/);
  if (appMatch) return `/${appMatch[1].replace(/\\/g, '/')}`;
  return undefined;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9/\s-_]/g, ' ').split(/[\s-_/]+/).filter((t) => t.length > 1);
}
