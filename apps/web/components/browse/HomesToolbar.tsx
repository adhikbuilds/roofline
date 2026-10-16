import { verdictToken, BADGE_LABEL } from '@/lib/fairness';
import { FilterChip } from './FilterChip';
import { NavSelect } from './NavSelect';
import {
  BHK_KEYS, BHK_LABEL, BUDGETS, FURNISHING_KEYS, FURNISHING_LABEL, SORT_KEYS, SORT_LABEL, VERDICT_KEYS,
  activeBudget, homesHref, toggle, type HomesFilters,
} from './filters';

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="min-w-0">
      {/* On phones the chips speak for themselves, so the labels collapse to keep listings above the fold. */}
      <p className="type-label sr-only mb-2 text-[12px] uppercase tracking-[0.08em] text-ink-3 sm:not-sr-only sm:block">{label}</p>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [mask-image:linear-gradient(to_right,black_82%,transparent)] [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 sm:[mask-image:none] [&::-webkit-scrollbar]:hidden">
        {children}
      </div>
    </div>
  );
}

/** Server component: every chip is a link whose href is the current filters with that one value toggled. */
export function HomesToolbar({ filters: f }: { filters: HomesFilters }) {
  const budget = activeBudget(f);
  return (
    <section
      aria-label="Filter homes"
      data-testid="homes-toolbar"
      className="rounded-[16px] border border-line bg-surface p-4 shadow-card sm:p-5"
    >
      <div className="flex flex-col gap-x-10 gap-y-3 sm:flex-row sm:flex-wrap sm:gap-y-5">
        <Group label="Bedrooms">
          {BHK_KEYS.map((k) => (
            <FilterChip key={k} testId={`chip-bhk-${k}`} selected={f.bhk.includes(k)} href={homesHref({ ...f, bhk: toggle(f.bhk, k) })}>
              {BHK_LABEL[k]}
            </FilterChip>
          ))}
        </Group>
        <Group label="Budget per month">
          {BUDGETS.map((b) => {
            const on = budget === b.id;
            return (
              <FilterChip
                key={b.id}
                testId={`chip-budget-${b.id}`}
                selected={on}
                href={homesHref({ ...f, min: on ? null : b.min, max: on ? null : b.max })}
              >
                {b.label}
              </FilterChip>
            );
          })}
        </Group>
        <Group label="Furnishing">
          {FURNISHING_KEYS.map((k) => (
            <FilterChip key={k} testId={`chip-furn-${k}`} selected={f.furn.includes(k)} href={homesHref({ ...f, furn: toggle(f.furn, k) })}>
              {FURNISHING_LABEL[k]}
            </FilterChip>
          ))}
        </Group>
        <Group label="Verdict">
          {VERDICT_KEYS.map((k) => (
            <FilterChip
              key={k}
              testId={`chip-verdict-${k}`}
              selected={f.verdict.includes(k)}
              dot={verdictToken(k)}
              href={homesHref({ ...f, verdict: toggle(f.verdict, k) })}
            >
              {BADGE_LABEL[k]}
            </FilterChip>
          ))}
        </Group>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3 sm:mt-5 sm:pt-4">
        <p className="hidden text-[13px] text-ink-3 sm:block">Verdicts compare each rent with the estimated fair rent for similar homes.</p>
        <NavSelect
          label="Sort by"
          value={f.sort}
          className="ml-auto"
          options={SORT_KEYS.map((s) => ({ value: s, label: SORT_LABEL[s], href: homesHref({ ...f, sort: s }) }))}
        />
      </div>
    </section>
  );
}
