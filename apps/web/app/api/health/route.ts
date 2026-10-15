import { ENGINE_VERSION } from '@roofline/engine';
import { DATA_MODE } from '@/lib/env';
import { buildHealth } from '@/lib/health';

export const dynamic = 'force-dynamic';

async function probe() {
  const { withReadOnly } = await import('@roofline/db');
  return withReadOnly(async (client) => {
    await client.query('SELECT 1');
    const r = await client.query<{ id: string }>('SELECT id FROM model_runs WHERE is_active');
    return { activeRunId: r.rows[0]?.id ?? null };
  });
}

export async function GET() {
  const { status, body } = await buildHealth(probe, { engineVersion: ENGINE_VERSION, dataMode: DATA_MODE });
  return Response.json(body, { status });
}
