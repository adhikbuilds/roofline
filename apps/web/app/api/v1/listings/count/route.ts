import { NextResponse } from 'next/server';
import { parseCountParams } from '@/lib/count-params';
import { cachedCount, takeCountBudget } from '@/lib/count-service';
import { clientKey } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/listings/count?loc=&bhk=&min=&max=&kind= -> { count }. Read-only; backs the live "Search N homes" button. */
export async function GET(req: Request) {
  const key = clientKey(req.headers);
  const gate = key === null ? null : takeCountBudget(key);
  if (gate && !gate.allowed) {
    return NextResponse.json({ error: 'rate limited' }, { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } });
  }
  const parsed = parseCountParams(new URL(req.url).searchParams);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const count = await cachedCount(parsed.filters);
  if (count === null) return NextResponse.json({ error: 'count unavailable' }, { status: 503 });
  return NextResponse.json({ count }, { headers: { 'Cache-Control': 'private, max-age=15' } });
}
