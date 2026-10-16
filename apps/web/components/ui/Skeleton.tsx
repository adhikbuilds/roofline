import { cn } from './cn';

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('skeleton rounded-[8px]', className)} />;
}

/** Placeholder with the same footprint as ListingCard, shown while a page loads. */
export function ListingCardSkeleton() {
  return (
    <div role="status" aria-label="Loading listing" className="overflow-hidden rounded-[16px] border border-line bg-surface p-2 shadow-card">
      <Skeleton className="aspect-[4/3] w-full rounded-[12px]" />
      <div className="space-y-3 p-3">
        <Skeleton className="h-7 w-2/5" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-[18px] w-[132px]" />
      </div>
    </div>
  );
}
