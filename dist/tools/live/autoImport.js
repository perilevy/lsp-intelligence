import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { defineTool } from '../registry.js';
import { relativePath, uriToPath } from '../../engine/positions.js';
import { DEFAULT_TIMEOUTS } from '../../engine/types.js';
/**
 * Read tsconfig.json paths from a directory, walking up to find the nearest one.
 */
function findTsConfigPaths(startDir, workspaceRoot) {
    let dir = startDir;
    while (dir.startsWith(workspaceRoot)) {
        const tsconfigPath = path.join(dir, 'tsconfig.json');
        if (fs.existsSync(tsconfigPath)) {
            try {
                const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf-8'));
                if (tsconfig.compilerOptions?.paths) {
                    return tsconfig.compilerOptions.paths;
                }
            }
            catch { }
        }
        const parent = path.dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return null;
}
/**
 * Match a source file path against tsconfig paths to find the alias.
 * E.g., paths: { "@myorg/core/*": ["../core/src/*"] }
 * sourcePath: /repo/packages/core/src/sdk.ts
 * tsconfigDir: /repo/packages/app
 * → returns "@myorg/core/sdk"
 */
function resolveAlias(sourcePath, paths, tsconfigDir) {
    for (const [alias, targets] of Object.entries(paths)) {
        for (const target of targets) {
            // Resolve the target relative to the tsconfig directory
            const resolvedTarget = path.resolve(tsconfigDir, target.replace(/\/?\*$/, ''));
            if (sourcePath.startsWith(resolvedTarget)) {
                const remainder = sourcePath
                    .slice(resolvedTarget.length)
                    .replace(/^\//, '')
                    .replace(/\/index\.tsx?$/, '')
                    .replace(/\.tsx?$/, '');
                const aliasBase = alias.replace(/\/?\*$/, '');
                return remainder ? `${aliasBase}/${remainder}` : aliasBase;
            }
        }
    }
    return null;
}
export const autoImport = defineTool({
    name: 'auto_import',
    description: 'Resolve the correct import path for a symbol name. Uses tsconfig paths when available. Eliminates wrong import paths — the most common agent mistake.',
    schema: z.object({
        symbol: z.string().describe('Symbol name to import, e.g. "UserService"'),
        from_file: z.string().optional().describe('File that needs the import (for tsconfig paths resolution)'),
    }),
    async handler(params, engine) {
        const resolved = await engine.resolveSymbol(params.symbol);
        const defUri = resolved.uri;
        const defPath = uriToPath(defUri);
        // Follow to the actual definition (not re-export)
        const def = await engine.request('textDocument/definition', {
            textDocument: { uri: defUri },
            position: resolved.position,
        }, DEFAULT_TIMEOUTS.live).catch(() => null);
        const sourcePath = def
            ? uriToPath(Array.isArray(def) ? def[0].uri : def.uri)
            : defPath;
        const rel = relativePath(sourcePath, engine.workspaceRoot);
        let importPath = rel;
        // Strategy 1: Use tsconfig paths (most accurate — respects aliases)
        const fromDir = params.from_file
            ? path.dirname(params.from_file)
            : engine.workspaceRoot;
        const tsconfigPaths = findTsConfigPaths(fromDir, engine.workspaceRoot);
        if (tsconfigPaths) {
            const tsconfigDir = findTsConfigDir(fromDir, engine.workspaceRoot);
            if (tsconfigDir) {
                const alias = resolveAlias(sourcePath, tsconfigPaths, tsconfigDir);
                if (alias)
                    importPath = alias;
            }
        }
        // Strategy 2: Fall back to package.json name
        if (importPath === rel) {
            const pkgMatch = sourcePath.match(/\/(packages|apps|libs|modules|services)\/([^/]+)\//);
            if (pkgMatch) {
                const pkgDir = sourcePath.substring(0, sourcePath.indexOf(`/${pkgMatch[1]}/${pkgMatch[2]}/`) + `/${pkgMatch[1]}/${pkgMatch[2]}`.length + 1);
                const pkgJsonPath = path.join(pkgDir, 'package.json');
                try {
                    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
                    if (pkgJson.name) {
                        const afterPkg = sourcePath.replace(pkgDir, '');
                        const cleanPath = afterPkg.replace(/^\/?src\//, '').replace(/\/?index\.tsx?$/, '').replace(/\.tsx?$/, '').replace(/\/$/, '');
                        importPath = !cleanPath || cleanPath === '/'
                            ? pkgJson.name
                            : `${pkgJson.name}${cleanPath}`;
                    }
                }
                catch { }
            }
        }
        return `# Auto Import: ${params.symbol}\n\n\`\`\`typescript\nimport { ${params.symbol} } from "${importPath}";\n\`\`\`\n\nSource: ${rel}`;
    },
});
function findTsConfigDir(startDir, workspaceRoot) {
    let dir = startDir;
    while (dir.startsWith(workspaceRoot)) {
        if (fs.existsSync(path.join(dir, 'tsconfig.json')))
            return dir;
        const parent = path.dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return null;
}
//# sourceMappingURL=autoImport.js.map