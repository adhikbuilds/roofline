import Link from 'next/link';
import { RooflineMark } from './Logo';

const COLUMNS = [
  {
    title: 'Product',
    links: [
      { href: '/homes', label: 'Homes' },
      { href: '/pgs', label: 'PGs' },
      { href: '/deals', label: 'Deals' },
      { href: '/compare', label: 'Compare' },
      { href: '/analytics', label: 'Analytics' },
    ],
  },
  {
    title: 'Data',
    links: [
      { href: '/methodology', label: 'Methodology' },
      { href: '/analytics/quality', label: 'Data quality' },
      { href: '/localities', label: 'Localities' },
      { href: '/api-docs', label: 'API' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: '/activity', label: 'Saved homes' },
      { href: '/signin', label: 'Sign in' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: '/privacy', label: 'Privacy' },
      { href: '/terms', label: 'Terms' },
      { href: '/methodology', label: 'Demo data notice' },
    ],
  },
] as const;

export function Footer() {
  return (
    <footer className="mt-16 border-t border-line bg-surface pb-20 md:pb-0">
      <div className="mx-auto grid max-w-[1320px] gap-10 px-4 py-12 md:px-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)]">
        <div className="max-w-sm">
          <div className="flex items-center gap-2 text-purple">
            <RooflineMark size={24} />
            <span className="type-display text-[20px] text-ink">roofline</span>
          </div>
          <p className="mt-4 text-ink-2">
            Every rental in Bangalore, counted once, priced against its neighbours, and measured against your commute.
          </p>
          <p className="mt-3 text-[14px] text-ink-3">Roofline never charges brokerage.</p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4">
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h2 className="type-label text-[13px] uppercase tracking-[0.08em] text-ink-3">{col.title}</h2>
              <ul className="mt-3 flex flex-col gap-1">
                {col.links.map((l) => (
                  <li key={`${col.title}-${l.label}`}>
                    <Link href={l.href} className="inline-flex min-h-9 items-center text-[15px] text-ink-2 transition-colors hover:text-purple">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-[1320px] flex-col gap-1 px-4 py-5 text-[13px] text-ink-3 md:flex-row md:items-center md:justify-between md:px-8">
          <p>
            Map data ©{' '}
            <a href="https://www.openstreetmap.org/copyright" className="underline underline-offset-2 hover:text-purple" rel="noreferrer">
              OpenStreetMap contributors
            </a>
            .
          </p>
          <p>Listings shown are synthetic demo data. © {new Date().getFullYear()} Roofline</p>
        </div>
      </div>
    </footer>
  );
}
