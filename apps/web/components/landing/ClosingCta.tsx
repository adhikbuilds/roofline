import { SearchConsole, type ConsoleLocality } from './SearchConsole';

/** Indigo band that repeats the search console in its compact (one-row) layout. */
export function ClosingCta({ localities, total }: { localities: ConsoleLocality[]; total: number | null }) {
  return (
    <section aria-labelledby="cta-title" className="relative -mb-16 overflow-hidden bg-ink">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(50% 80% at 85% 0%, rgb(109 40 217 / 0.55), transparent 70%), radial-gradient(40% 70% at 0% 100%, rgb(14 165 233 / 0.18), transparent 70%)',
        }}
      />
      <div className="relative mx-auto max-w-[1320px] px-4 py-16 md:px-8 md:py-24">
        <h2 id="cta-title" className="type-display max-w-[26ch] text-[34px] leading-[38px] text-white md:text-[48px] md:leading-[52px]">
          Find a rent that is actually fair.
        </h2>
        <p className="mt-4 max-w-[52ch] text-[17px] leading-[27px] text-white/75">
          Pick a locality, a size and a budget. Every result comes with its fair-rent check, and every duplicate is already merged.
        </p>
        <div className="mt-8">
          <SearchConsole testId="cta-console" localities={localities} initialCount={total} compact />
        </div>
      </div>
    </section>
  );
}
