import { describe, it, expect } from 'vitest';
import { parseSourceFile } from '../src/analysis/ts/parseSourceFile.js';
import { extractUsages } from '../src/analysis/ts/extractUsages.js';
import { extractDeclarations } from '../src/analysis/ts/extractDeclarations.js';
import * as path from 'path';

const FIXTURE_ROOT = path.resolve(import.meta.dirname, '..', 'test-fixtures', 'monorepo');
const STANDALONE_ROOT = path.resolve(import.meta.dirname, '..', 'test-fixtures', 'standalone');

describe('Usage Index', () => {
  it('indexes useEffect call sites in TSX fixture', () => {
    const sf = parseSourceFile(path.join(STANDALONE_ROOT, 'web/src/effects.tsx'));
    expect(sf).not.toBeNull();
    const usages = extractUsages(sf!);
    const useEffectUsages = usages.filter((u) => u.identifier === 'useEffect');
    // effects.tsx has 4 useEffect calls
    expect(useEffectUsages.length).toBeGreaterThanOrEqual(4);
    expect(useEffectUsages.every((u) => u.kind === 'call')).toBe(true);
  });

  it('indexes useMemo and useCallback calls', () => {
    const sf = parseSourceFile(path.join(STANDALONE_ROOT, 'web/src/effects.tsx'));
    const usages = extractUsages(sf!);
    expect(usages.some((u) => u.identifier === 'useMemo')).toBe(true);
    expect(usages.some((u) => u.identifier === 'useCallback')).toBe(true);
  });

  it('indexes import specifiers', () => {
    const sf = parseSourceFile(path.join(FIXTURE_ROOT, 'packages/app/src/ItemList.ts'));
    const usages = extractUsages(sf!);
    const imports = usages.filter((u) => u.kind === 'import');
    expect(imports.some((u) => u.identifier === 'createSDK')).toBe(true);
    expect(imports.some((u) => u.identifier === 'withConsumer')).toBe(true);
  });

  it('tracks enclosing symbol for call sites', () => {
    const sf = parseSourceFile(path.join(STANDALONE_ROOT, 'web/src/effects.tsx'));
    const usages = extractUsages(sf!);
    const inConditional = usages.find(
      (u) => u.identifier === 'useEffect' && u.enclosingSymbol === 'ConditionalCleanupComponent',
    );
    expect(inConditional).toBeDefined();
  });

  it('does not leak enclosing context across sibling functions', () => {
    const sf = parseSourceFile(path.join(STANDALONE_ROOT, 'web/src/effects.tsx'));
    const usages = extractUsages(sf!);

    // useMemo in MemoComponent must NOT carry enclosing from a prior function
    const memoUsage = usages.find(
      (u) => u.identifier === 'useMemo' && u.kind === 'call',
    );
    expect(memoUsage).toBeDefined();
    expect(memoUsage!.enclosingSymbol).toBe('MemoComponent');

    // useCallback in CallbackComponent must have correct enclosing
    const cbUsage = usages.find(
      (u) => u.identifier === 'useCallback' && u.kind === 'call',
    );
    expect(cbUsage).toBeDefined();
    expect(cbUsage!.enclosingSymbol).toBe('CallbackComponent');

    // NoCleanupComponent's useEffect must not leak from prior component
    const noCleanup = usages.find(
      (u) => u.identifier === 'useEffect' && u.enclosingSymbol === 'NoCleanupComponent',
    );
    expect(noCleanup).toBeDefined();
  });
});

describe('Declaration Index', () => {
  it('extracts exported functions from TS AST', () => {
    const sf = parseSourceFile(path.join(FIXTURE_ROOT, 'packages/core/src/validate.ts'));
    expect(sf).not.toBeNull();
    const decls = extractDeclarations(sf!);
    const names = decls.map((d) => d.symbol);
    expect(names).toContain('validateConfig');
    expect(names).toContain('isValidTransition');
    expect(names).toContain('canEditItems');
    expect(decls.every((d) => d.isExported)).toBe(true);
  });

  it('includes symbol tokens for searching', () => {
    const sf = parseSourceFile(path.join(FIXTURE_ROOT, 'packages/core/src/validate.ts'));
    const decls = extractDeclarations(sf!);
    const vc = decls.find((d) => d.symbol === 'validateConfig');
    expect(vc?.symbolTokens).toContain('validate');
    expect(vc?.symbolTokens).toContain('config');
  });
});
