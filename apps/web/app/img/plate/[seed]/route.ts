import { PLATE_SEED, plateSvg } from '@/lib/plate';

export async function GET(_req: Request, ctx: { params: Promise<{ seed: string }> }) {
  const { seed } = await ctx.params;
  if (!PLATE_SEED.test(seed)) {
    return new Response('Invalid seed', { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  return new Response(plateSvg(seed), {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=31536000, immutable',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}
