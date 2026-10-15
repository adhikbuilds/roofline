import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-[1320px] px-4 py-16 md:px-8">
      <h1 className="type-display text-[34px] leading-[40px]">This page isn’t built yet</h1>
      <p className="mt-3 max-w-[56ch] text-indigo-2">
        Roofline is being built in phases. Search, deals, compare and analytics arrive as each phase lands.
      </p>
      <Link href="/" className="type-label mt-6 inline-block rounded-full bg-purple px-5 py-2.5 text-white">
        Back to homes
      </Link>
    </div>
  );
}
