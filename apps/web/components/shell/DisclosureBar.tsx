import Link from 'next/link';

export function DisclosureBar({ mode }: { mode: string }) {
  if (mode !== 'synthetic') return null;
  return (
    <div role="note" className="bg-indigo text-[13px] leading-5 text-white/90">
      <p className="mx-auto max-w-[1320px] px-4 py-2 md:px-8">
        Demo data: these are synthetic listings generated for Bangalore, not real offers.{' '}
        <Link href="/methodology" className="underline decoration-white/40 underline-offset-2 hover:decoration-white">
          How the demo data is built
        </Link>
      </p>
    </div>
  );
}
