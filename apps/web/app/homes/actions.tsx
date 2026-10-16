'use server';

import type { ReactNode } from 'react';
import { HomeCard } from '@/components/browse/HomeCard';
import { decodeCursor, parseHomesFilters } from '@/components/browse/filters';
import { getHomesPage } from '@/lib/queries';

/**
 * Next page of cards, rendered on the server. Server actions are public endpoints, so the filter string and
 * the cursor are validated here exactly like page params: garbage filters are dropped, a bad cursor ends the list.
 */
export async function loadMoreHomes(qs: string, cursor: string): Promise<{ items: ReactNode[]; nextCursor: string | null; added: number }> {
  const c = decodeCursor(typeof cursor === 'string' ? cursor : null);
  if (!c) return { items: [], nextCursor: null, added: 0 };
  const filters = parseHomesFilters(new URLSearchParams(typeof qs === 'string' ? qs.slice(0, 600) : ''));
  const page = await getHomesPage(filters, c);
  return {
    items: page.rows.map((r, i) => <HomeCard key={r.id} row={r} index={i} />),
    nextCursor: page.nextCursor,
    added: page.rows.length,
  };
}
