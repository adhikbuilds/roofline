import { describe, expect, it } from 'vitest';
import { createTrace, formatTrace } from '../src/trace';

describe('trace', () => {
  it('starts empty', () => {
    expect(createTrace().build().steps).toEqual([]);
  });

  it('records steps in order with optional data', () => {
    const t = createTrace().step('a', 'first').step('b', 'second', { n: 3 }).build();
    expect(t.steps).toEqual([
      { rule: 'a', message: 'first' },
      { rule: 'b', message: 'second', data: { n: 3 } },
    ]);
  });

  it('is immutable: stepping returns a new builder', () => {
    const base = createTrace().step('a', 'x');
    const forked = base.step('b', 'y');
    expect(base.build().steps).toHaveLength(1);
    expect(forked.build().steps).toHaveLength(2);
  });

  it('copies data so later mutation does not leak in', () => {
    const data = { n: 1 };
    const t = createTrace().step('a', 'x', data).build();
    data.n = 2;
    expect(t.steps[0]?.data).toEqual({ n: 1 });
  });

  it('formats one numbered line per step', () => {
    const t = createTrace().step('a', 'first').step('b', 'second').build();
    expect(formatTrace(t)).toBe('1. [a] first\n2. [b] second');
  });
});
