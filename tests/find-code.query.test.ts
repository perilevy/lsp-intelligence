import { describe, it, expect } from 'vitest';
import { parseQuery } from '../src/search/query/parseQuery.js';

describe('Query Parser', () => {
  it('preserves useEffect as exact identifier', () => {
    const ir = parseQuery('useEffect that returns a cleanup callback conditionally');
    expect(ir.exactIdentifiers).toContain('useEffect');
    expect(ir.nlTokens).not.toContain('useEffect');
  });

  it('preserves dotted identifiers like Promise.all', () => {
    const ir = parseQuery('where is Promise.all used');
    expect(ir.dottedIdentifiers).toContain('Promise.all');
  });

  it('preserves PascalCase identifiers', () => {
    const ir = parseQuery('find AbortController usage');
    expect(ir.exactIdentifiers).toContain('AbortController');
  });

  it('extracts structural predicates from cue words', () => {
    const ir = parseQuery('useEffect that returns a cleanup callback conditionally');
    expect(ir.structuralPredicates).toContain('conditional');
    expect(ir.structuralPredicates).toContain('returns-cleanup');
    expect(ir.structuralPredicates).toContain('hook-callback');
  });

  it('does NOT classify "callback" as fetching', () => {
    const ir = parseQuery('useEffect that returns a cleanup callback conditionally');
    expect(ir.familyScores['fetching']).toBeUndefined();
  });

  it('routes useEffect+structural to structural mode', () => {
    const ir = parseQuery('useEffect that returns a cleanup callback conditionally');
    expect(ir.mode).toBe('structural');
    expect(ir.routingReasons).toContain('exact identifier detected');
    expect(ir.routingReasons).toContain('structural cues detected');
  });

  it('routes "where do we validate permissions" to behavior mode', () => {
    const ir = parseQuery('where do we validate permissions');
    expect(ir.mode).toBe('behavior');
    expect(Object.keys(ir.familyScores).length).toBeGreaterThan(0);
  });

  it('routes "where is Promise.all used" to identifier mode', () => {
    const ir = parseQuery('where is Promise.all used');
    expect(ir.mode).toBe('identifier');
    expect(ir.dottedIdentifiers).toContain('Promise.all');
  });

  it('handles forced mode', () => {
    const ir = parseQuery('permissions', { forcedMode: 'structural' });
    expect(ir.mode).toBe('structural');
  });

  it('handles forced family', () => {
    const ir = parseQuery('something generic', { forcedFamily: 'auth_permission' });
    expect(ir.familyScores['auth_permission']).toBeGreaterThan(0);
  });

  it('handles "without" modifier for negation', () => {
    const ir = parseQuery('useEffect without cleanup');
    expect(ir.structuralPredicates).toContain('no-cleanup');
  });
});
