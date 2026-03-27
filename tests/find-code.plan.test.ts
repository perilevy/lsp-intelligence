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

  it('routes mixed queries to multiple retrievers', () => {
    const ir = parseQuery('permission guard that returns boolean');
    const plan = planQuery(ir);
    // Should have behavior (permission) + structural (returns)
    expect(plan.retrievers.length).toBeGreaterThanOrEqual(2);
  });

  it('always has at least one retriever', () => {
    const ir = parseQuery('xyz random gibberish');
    const plan = planQuery(ir);
    expect(plan.retrievers.length).toBeGreaterThanOrEqual(1);
  });
});
