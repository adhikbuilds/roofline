'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV } from './nav';

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="hidden md:block">
      <ul className="flex items-center gap-1">
        {NAV.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`type-label rounded-full px-3.5 py-1.5 text-[14px] transition-colors duration-150 ${
                  active ? 'bg-purple text-white' : 'text-indigo-2 hover:bg-purple-soft hover:text-indigo'
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const TABS = NAV.filter((n) => n.href !== '/analytics');

export function TabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="grid grid-cols-4">
        {TABS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`type-label flex h-14 flex-col items-center justify-center gap-1 text-[13px] ${
                  active ? 'text-purple' : 'text-indigo-2'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`h-1 w-6 rounded-full ${active ? 'bg-purple' : 'bg-transparent'}`}
                />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
