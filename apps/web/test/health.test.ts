import { describe, expect, it } from 'vitest';
import { buildHealth } from '../lib/health';

const meta = { engineVersion: '0.3.0', dataMode: 'synthetic' };

describe('buildHealth', () => {
  it('reports ok with the active model run id as the data version', async () => {
    const h = await buildHealth(async () => ({ activeRunId: '7' }), meta);
    expect(h.status).toBe(200);
    expect(h.body).toEqual({ ok: true, db: true, dataVersion: 7, engineVersion: '0.3.0', dataMode: 'synthetic' });
  });

  it('accepts a numeric run id (bigint comes back from pg as a string, drizzle maps to number)', async () => {
    const h = await buildHealth(async () => ({ activeRunId: 12 }), meta);
    expect(h.body.dataVersion).toBe(12);
  });

  it('dataVersion is null when no model run is active, and the service is still ok', async () => {
    const h = await buildHealth(async () => ({ activeRunId: null }), meta);
    expect(h.status).toBe(200);
    expect(h.body).toEqual({ ok: true, db: true, dataVersion: null, engineVersion: '0.3.0', dataMode: 'synthetic' });
  });

  it('a database failure yields 503 with db false and no data version, without leaking the error', async () => {
    const h = await buildHealth(async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:5432 password=hunter2');
    }, meta);
    expect(h.status).toBe(503);
    expect(h.body).toEqual({ ok: false, db: false, dataVersion: null, engineVersion: '0.3.0', dataMode: 'synthetic' });
    expect(JSON.stringify(h.body)).not.toContain('hunter2');
  });

  it('an unparseable run id is treated as no data version rather than NaN', async () => {
    const h = await buildHealth(async () => ({ activeRunId: 'abc' }), meta);
    expect(h.body.dataVersion).toBeNull();
    expect(h.body.db).toBe(true);
  });
});
