import { ClosingCta } from '@/components/landing/ClosingCta';
import { DealsSection } from '@/components/landing/DealsSection';
import { Hero } from '@/components/landing/Hero';
import { HowItWorks, type HowData } from '@/components/landing/HowItWorks';
import { LocalityGrid } from '@/components/landing/LocalityGrid';
import { MapTeaser } from '@/components/landing/MapTeaser';
import { TryIt } from '@/components/landing/TryIt';
import { projectMap } from '@/lib/landing';
import { splitReason } from '@/lib/fairness';
import { bhkLabel } from '@/lib/photos';
import {
  getCityOutline,
  getFeaturedFair,
  getLandingDeals,
  getLandingLocalities,
  getLandingStats,
  getLedger,
  getLocalityTrends,
  getMergeExample,
} from '@/lib/queries';

export const dynamic = 'force-dynamic';
export const metadata = { title: { absolute: 'Roofline: every rental in Bangalore, counted once' } };

export default async function LandingPage() {
  const [deals, stats, ledger, localities, outline, featured, merge] = await Promise.all([
    getLandingDeals(),
    getLandingStats(),
    getLedger(),
    getLandingLocalities(),
    getCityOutline(),
    getFeaturedFair(),
    getMergeExample(),
  ]);
  const busiest = localities.filter((l) => l.listings > 0).slice(0, 12);
  const trends = await getLocalityTrends(busiest.map((l) => l.slug));
  const total = stats ? stats.flats + stats.pgBeds : null;
  const { dots, outlinePath } = projectMap(
    localities.map((l) => ({ slug: l.slug, name: l.name, lat: l.lat, lng: l.lng, listings: l.listings, median2bhkRent: l.median2bhkRent })),
    outline,
    640,
    600,
  );

  const how: HowData = {
    merge,
    priced: featured
      ? {
          localityName: featured.localityName,
          bhk: featured.bhk,
          rentInr: featured.rentInr,
          fairInr: featured.fair.fairInr,
          lowInr: featured.fair.lowInr,
          highInr: featured.fair.highInr,
          badge: featured.fair.badge,
        }
      : null,
    ranked: deals.slice(0, 4).map((d) => ({
      id: d.id,
      localityName: d.localityName,
      label: `${bhkLabel(d.unitKind, d.bhk)}${d.areaSqft ? ` · ${d.areaSqft.toLocaleString('en-IN')} sq ft` : ''}`,
      rentInr: d.rentInr,
      highlight: splitReason(d.reason).highlight.replace(' fair rent', ''),
      pct: Math.abs(Math.round((d.fair.deltaPct ?? 0) * 100)),
    })),
  };

  return (
    <>
      <Hero deals={deals} stats={stats} ledger={ledger} localities={localities} total={total} />
      <DealsSection deals={deals} />
      {featured && (
        <TryIt
          data={{
            id: featured.id,
            localityName: featured.localityName,
            bhk: featured.bhk,
            rentInr: featured.rentInr,
            areaSqft: featured.areaSqft,
            comps: featured.comps,
            fairInr: featured.fair.fairInr,
            lowInr: featured.fair.lowInr,
            highInr: featured.fair.highInr,
            confidence: featured.fair.confidence,
          }}
        />
      )}
      <HowItWorks data={how} />
      <LocalityGrid localities={busiest} trends={trends} />
      <MapTeaser dots={dots} outlinePath={outlinePath} />
      <ClosingCta localities={localities} total={total} />
    </>
  );
}
