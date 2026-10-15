import type { Metadata } from 'next';
import { formatINR } from '@roofline/engine';
import { getLocalities } from '@/lib/queries';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Localities' };

const ZONES: Record<string, string> = {
  central: 'Central', east: 'East', south_east: 'South-east', south: 'South', west: 'West', north: 'North',
  north_east: 'North-east',
};

export default async function LocalitiesPage() {
  const rows = await getLocalities();
  return (
    <div className="mx-auto max-w-[1320px] px-4 pt-8 md:px-8 md:pt-12">
      <h1 className="type-display text-[34px] leading-[38px] md:text-[52px] md:leading-[56px]">Localities</h1>
      <p className="figures mt-4 text-[17px] leading-[26px] text-indigo-2">
        {rows.length} localities across Bangalore, with the median 2BHK rent where there are listings to measure.
      </p>
      {rows.length === 0 ? (
        <p className="mt-10 rounded-[var(--radius-panel)] border border-line bg-surface p-6 text-indigo-2">
          No localities loaded yet. Run <code className="rounded bg-concrete px-1.5 py-0.5 text-indigo">pnpm db:fresh</code>.
        </p>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-surface">
          <table className="w-full min-w-[420px] text-left">
            <thead>
              <tr className="type-label border-b border-line text-indigo-2">
                <th scope="col" className="px-4 py-3">Locality</th>
                <th scope="col" className="px-4 py-3">Zone</th>
                <th scope="col" className="px-4 py-3 text-right">Listings</th>
                <th scope="col" className="px-4 py-3 text-right">Median 2BHK rent</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.slug} data-testid="locality-row" className="border-b border-line last:border-b-0">
                  <th scope="row" className="px-4 py-3 font-medium">{r.name}</th>
                  <td className="px-4 py-3 text-indigo-2">{ZONES[r.zone] ?? r.zone}</td>
                  <td className="figures px-4 py-3 text-right">{r.listings.toLocaleString('en-IN')}</td>
                  <td className="figures px-4 py-3 text-right">
                    {r.median2bhkRent == null ? <span className="text-indigo-2">Not enough listings</span> : formatINR(r.median2bhkRent)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
