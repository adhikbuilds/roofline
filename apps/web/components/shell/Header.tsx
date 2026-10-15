import Link from 'next/link';
import { Logo } from './Logo';
import { NavLinks } from './NavLinks';

export function Header() {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between gap-4 px-4 md:px-8">
        <Logo />
        <NavLinks />
        <div className="flex items-center gap-2">
          <Link
            href="/activity"
            className="type-label hidden rounded-full px-3 py-1.5 text-[14px] text-indigo-2 hover:text-indigo sm:inline-block"
          >
            Saved
          </Link>
          <Link
            href="/signin"
            className="type-label rounded-full border border-indigo px-4 py-1.5 text-[14px] text-indigo hover:bg-indigo hover:text-white"
          >
            Sign in
          </Link>
        </div>
      </div>
    </header>
  );
}
