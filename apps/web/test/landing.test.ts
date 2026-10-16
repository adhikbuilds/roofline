import { badgeFor } from '@roofline/engine';
import { describe, expect, it } from 'vitest';
import { BUDGET_MAX, BUDGET_MIN, consoleParams, homesHref, projectMap, sparkPaths, tryItVerdict } from '@/lib/landing';

describe('consoleParams', () => {
  it('omits everything when nothing is chosen', () => {
    expect(consoleParams({ loc: null, bhk: 'any', budget: [BUDGET_MIN, BUDGET_MAX] }).toString()).toBe('');
    expect(homesHref({ loc: null, bhk: 'any', budget: [BUDGET_MIN, BUDGET_MAX] })).toBe('/homes');
  });
  it('keeps only bounds that are off the end stops', () => {
    const p = consoleParams({ loc: 'koramangala', bhk: '4plus', budget: [BUDGET_MIN, 60000] });
    expect(p.get('loc')).toBe('koramangala');
    expect(p.get('bhk')).toBe('4plus');
    expect(p.has('min')).toBe(false);
    expect(p.get('max')).toBe('60000');
    const q = consoleParams({ loc: null, bhk: 'rk', budget: [20000, BUDGET_MAX] });
    expect(q.get('min')).toBe('20000');
    expect(q.has('max')).toBe(false);
  });
});

describe('projectMap', () => {
  const pts = [
    { slug: 'a', name: 'A', lat: 12.9, lng: 77.5, listings: 100, median2bhkRent: 30000 },
    { slug: 'b', name: 'B', lat: 13.0, lng: 77.7, listings: 25, median2bhkRent: null },
  ];
  it('keeps dots inside the box, north up, east right, bigger dots for more listings', () => {
    const { dots, outlinePath } = projectMap(pts, [[77.4, 12.8], [77.8, 12.8], [77.8, 13.1], [77.4, 13.1]], 640, 600);
    for (const d of dots) {
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.x).toBeLessThanOrEqual(640);
      expect(d.y).toBeGreaterThanOrEqual(0);
      expect(d.y).toBeLessThanOrEqual(600);
    }
    expect(dots[1]!.y).toBeLessThan(dots[0]!.y);
    expect(dots[1]!.x).toBeGreaterThan(dots[0]!.x);
    expect(dots[0]!.r).toBeGreaterThan(dots[1]!.r);
    expect(outlinePath.startsWith('M')).toBe(true);
  });
  it('handles no data', () => {
    expect(projectMap([], [], 640, 600)).toEqual({ dots: [], outlinePath: '' });
  });
});

describe('sparkPaths', () => {
  it('reports the change and skips gaps', () => {
    const s = sparkPaths([100, null, 110], 100, 40);
    expect(s.changePct).toBeCloseTo(10);
    expect(s.line.startsWith('M')).toBe(true);
  });
  it('returns nothing for fewer than two points', () => {
    expect(sparkPaths([null, 5, null], 100, 40).line).toBe('');
  });
  it('draws a flat series level', () => {
    const s = sparkPaths([50, 50, 50], 100, 40);
    expect(s.changePct).toBe(0);
    expect(new Set(s.line.slice(1).split('L').map((p) => p.split(' ')[1])).size).toBe(1);
  });
});

describe('tryItVerdict', () => {
  it('uses the engine badge edges against the stored estimate', () => {
    const fair = 32000;
    expect(tryItVerdict(fair, fair, 'high', 'x').badge).toBe('fair');
    expect(tryItVerdict(Math.round(fair * 0.79), fair, 'high', 'x').badge).toBe('great_deal');
    expect(tryItVerdict(Math.round(fair * 1.21), fair, 'high', 'x').badge).toBe('overpriced');
    expect(tryItVerdict(30000, fair, 'medium', 'x').badge).toBe(badgeFor((30000 - fair) / fair, 'medium'));
  });
  it('words the difference', () => {
    expect(tryItVerdict(30000, 32000, 'high', 'a 2 BHK in Indiranagar').sentence).toBe('₹2,000 below the fair rent for a 2 BHK in Indiranagar.');
    expect(tryItVerdict(33000, 32000, 'high', 'here').sentence).toContain('above the fair rent');
    expect(tryItVerdict(32000, 32000, 'high', 'here').sentence).toMatch(/^Exactly/);
  });
  it('gives no badge at low confidence', () => {
    expect(tryItVerdict(20000, 32000, 'low', 'x').badge).toBeNull();
  });
});
