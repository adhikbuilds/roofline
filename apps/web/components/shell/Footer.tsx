import Link from 'next/link';
import { RooflineMark } from './Logo';

const LINKS = [
  { href: '/methodology', label: 'Methodology' },
  { href: '/analytics/quality', label: 'Data quality' },
  { href: '/api-docs', label: 'API' },
  { href: '/about', label: 'About' },
  { href: '/privacy', label: 'Privacy' },
];

export function Footer() {
  return (
    <footer className="mt-16 border-t border-line bg-surface pb-20 md:pb-0">
      <div className="mx-auto flex max-w-[1320px] flex-col gap-6 px-4 py-10 md:flex-row md:items-start md:justify-between md:px-8">
        <div className="max-w-sm">
          <div className="flex items-center gap-2 text-purple">
            <RooflineMark size={22} />
            <span className="type-display text-[18px] text-indigo">roofline</span>
          </div>
          <p className="mt-3 text-indigo-2">
            Every rental in Bangalore, counted once, priced against its neighbours, and measured against your commute.
          </p>
        </div>
        <ul className="grid grid-cols-2 gap-x-8 gap-y-2 sm:grid-cols-3">
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="text-indigo-2 hover:text-purple">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <p className="mx-auto max-w-[1320px] px-4 pb-8 text-[13px] text-indigo-2 md:px-8">
        Map data © OpenStreetMap contributors. Roofline never charges brokerage.
      </p>
    </footer>
  );
}
