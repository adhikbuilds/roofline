'use client';

import { Bookmark, LogIn } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cn } from '@/components/ui/cn';
import { Logo } from './Logo';
import { MobileMenu } from './MobileMenu';
import { NavLinks } from './NavLinks';

/**
 * Sticky header. On the landing page ("/") it floats transparently over the hero (negative margin so it takes no
 * layout space) and turns solid with a blur after the first few pixels of scroll. Everywhere else it is solid.
 */
export function Header() {
  const pathname = usePathname();
  const overHero = pathname === '/';
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, [pathname]);

  const transparent = overHero && !scrolled;
  return (
    <header
      data-testid="site-header"
      data-transparent={transparent}
      className={cn(
        'sticky top-0 z-40 border-b transition-[background-color,border-color,box-shadow,backdrop-filter] duration-200',
        overHero && '-mb-16',
        transparent
          ? 'border-transparent bg-transparent'
          : 'border-line bg-white/85 shadow-[0_1px_0_rgb(20_26_51/0.02),0_8px_24px_rgb(20_26_51/0.05)] backdrop-blur-xl backdrop-saturate-150',
      )}
    >
      <div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between gap-4 px-4 md:px-8">
        <Logo />
        <NavLinks />
        <div className="flex items-center gap-1.5">
          <Link
            href="/activity"
            className="type-label hidden h-10 items-center gap-1.5 rounded-[12px] px-3 text-[14px] text-ink-2 transition-colors hover:bg-purple-50 hover:text-purple-600 md:inline-flex"
          >
            <Bookmark size={16} strokeWidth={1.75} aria-hidden />
            Saved
          </Link>
          <Link
            href="/signin"
            className="type-label hidden h-10 items-center gap-1.5 rounded-[12px] bg-ink px-4 text-[14px] text-white transition-colors hover:bg-[#232b52] md:inline-flex"
          >
            <LogIn size={16} strokeWidth={1.75} aria-hidden />
            Sign in
          </Link>
          <MobileMenu />
        </div>
      </div>
    </header>
  );
}
