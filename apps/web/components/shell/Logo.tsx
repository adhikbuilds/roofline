import Link from 'next/link';

export function RooflineMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M4 17.5 16 8l12 9.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 25h18" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <circle cx="16" cy="17" r="2.25" fill="currentColor" />
    </svg>
  );
}

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 text-purple" aria-label="Roofline home">
      <RooflineMark />
      <span className="type-display text-[22px] leading-none text-indigo">roofline</span>
    </Link>
  );
}
