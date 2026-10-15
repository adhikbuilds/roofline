import { describe, expect, it } from 'vitest';
import { jaroWinkler } from '../../src/locality/jaro-winkler';

describe('jaroWinkler', () => {
  it.each([
    ['MARTHA', 'MARHTA', 0.9611],
    ['DWAYNE', 'DUANE', 0.84],
    ['DIXON', 'DICKSONX', 0.8133],
    ['abc', 'abc', 1],
    ['abc', 'xyz', 0],
    ['', '', 1],
    ['abc', '', 0],
    ['', 'abc', 0],
    ['a', 'b', 0],
  ])('%s vs %s', (a, b, want) => {
    expect(jaroWinkler(a, b)).toBeCloseTo(want, 3);
  });
  it('is symmetric and bounded', () => {
    for (const [a, b] of [['koramangala', 'koramangla'], ['hsr', 'btm'], ['whitefield', 'whitfield']] as const) {
      expect(jaroWinkler(a, b)).toBeCloseTo(jaroWinkler(b, a), 10);
      expect(jaroWinkler(a, b)).toBeGreaterThanOrEqual(0);
      expect(jaroWinkler(a, b)).toBeLessThanOrEqual(1);
    }
  });
  it('rewards common prefix', () => {
    expect(jaroWinkler('prefixabc', 'prefixabd')).toBeGreaterThan(jaroWinkler('abcprefix', 'dbcprefix'));
  });
  it('does not apply the prefix boost below the 0.7 jaro floor', () => {
    expect(jaroWinkler('abcdxxxxxx', 'abcdyyyyyyyyyy')).toBeLessThan(0.7);
  });
});
