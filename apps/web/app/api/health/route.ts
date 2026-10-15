import { ENGINE_VERSION } from '@roofline/engine';
import { DATA_MODE } from '@/lib/env';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ ok: true, engine: ENGINE_VERSION, dataMode: DATA_MODE });
}
