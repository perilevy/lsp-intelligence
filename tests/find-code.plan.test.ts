import { describe, it, expect } from 'vitest';
import { parseQuery } from '../src/search/query/parseQuery.js';
import { planQuery } from '../src/search/query/planQuery.js';

describe('Query Planner', () => {
  it('routes useEffect+cleanup+conditionally to identifier+structural', () => {
    const ir = parseQuery('useEffect that returns a cleanup callback conditionally');
    const plan = planQuery(ir);
    expect(plan.retrievers).toContain('identifier');
    expect(plan.retrievers).toContain('structural');
    expect(plan.retrievers).not.toContain('behavior');
  });

  it('routes "where do we validate permissions" to behavior', () => {
    const ir = parseQuery('where do we validate permissions');
    const plan = planQuery(ir);
    expect(plan.retrievers).toContain('behavior');
  });

  it('routes "where is Promise.all used" to identifier', () => {
    const ir = parseQuery('where is Promise.all used');
    const plan = planQuery(ir);
    expect(plan.retrievers).toContain('identifier');
  });

  it('routes NL permission query to behavior only (returns alone is not structural)', () => {
    const ir = parseQuery('permission guard that returns boolean');
    const plan = planQuery(ir);
    // "returns" alone no longer implies structural — this should be behavior-only
    expect(plan.retrievers).toContain('behavior');
    expect(plan.retrievers).not.toContain('structural');
  });

  it('routes mixed queries to multiple retrievers', () => {
    const ir = parseQuery('useEffect permission hook that returns cleanup');
    const plan = planQuery(ir);
    // Hook identifier + "returns cleanup" → structural + identifier
    expect(plan.retrievers.length).toBeGreaterThanOrEqual(2);
  });

  it('always has at least one retriever', () => {
    const ir = parseQuery('xyz random gibberish');
    const plan = planQuery(ir);
    expect(plan.retrievers.length).toBeGreaterThanOrEqual(1);
  });

  it('adds doc retriever for behavior queries', () => {
    const ir = parseQuery('where do we validate permissions');
    const plan = planQuery(ir);
    expect(plan.retrievers).toContain('doc');
  });

  it('adds config retriever for route-like queries', () => {
    const ir = parseQuery('where is the API endpoint defined');
    const plan = planQuery(ir);
    expect(plan.retrievers).toContain('config');
  });

  it('adds config retriever for config-like queries', () => {
    const ir = parseQuery('where is the feature flag configured');
    const plan = planQuery(ir);
    expect(plan.retrievers).toContain('config');
  });

  it('enables graph expansion for implementation-root queries', () => {
    const ir = parseQuery('where is this actually implemented');
    const plan = planQuery(ir);
    expect(plan.expandGraph).toBe(true);
  });

  it('does not enable graph expansion for plain queries', () => {
    const ir = parseQuery('useEffect cleanup');
    const plan = planQuery(ir);
    expect(plan.expandGraph).toBe(false);
  });
});
