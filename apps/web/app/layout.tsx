import type { Metadata, Viewport } from 'next';
import { Anek_Latin } from 'next/font/google';
import { DisclosureBar } from '@/components/shell/DisclosureBar';
import { Footer } from '@/components/shell/Footer';
import { Header } from '@/components/shell/Header';
import { TabBar } from '@/components/shell/NavLinks';
import { DATA_MODE } from '@/lib/env';
import './globals.css';

const anek = Anek_Latin({
  subsets: ['latin'],
  axes: ['wdth'],
  display: 'swap',
  variable: '--font-anek',
});

export const metadata: Metadata = {
  title: { default: 'Roofline: every rental in Bangalore, counted once', template: '%s | Roofline' },
  description:
    'Flats and PGs across Bangalore with duplicates merged, a fair-rent check on every listing, and commute times from your office.',
};

export const viewport: Viewport = { themeColor: '#1C2342', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={anek.variable}>
      <body className="min-h-dvh antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2"
        >
          Skip to listings
        </a>
        <DisclosureBar mode={DATA_MODE} />
        <Header />
        <main id="main" data-ready="true">
          {children}
        </main>
        <Footer />
        <TabBar />
      </body>
    </html>
  );
}
