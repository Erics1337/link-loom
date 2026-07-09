function SkeletonBar({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-ll-border/60 ${className ?? ""}`}
      aria-hidden="true"
    />
  );
}

function TopbarSkeleton({ actionWidth = "w-64" }: { actionWidth?: string }) {
  return (
    <header className="ll-topbar">
      <SkeletonBar className="h-7 w-40" />
      <div className="flex items-center gap-4">
        <SkeletonBar className={`h-9 ${actionWidth} rounded-full`} />
        <SkeletonBar className="h-9 w-28 rounded-ll-md" />
      </div>
    </header>
  );
}

function StatCardsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className="ll-panel-solid min-h-[7.5rem] p-6"
          aria-hidden="true"
        >
          <SkeletonBar className="h-4 w-32" />
          <SkeletonBar className="mt-4 h-9 w-20" />
          <SkeletonBar className="mt-2 h-4 w-24" />
        </div>
      ))}
    </div>
  );
}

function ListRowsSkeleton({
  rows = 5,
  rowClassName = "min-h-[4.5rem]",
}: {
  rows?: number;
  rowClassName?: string;
}) {
  return (
    <ul className="divide-y divide-ll-border" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <li key={index} className={`ll-row px-6 py-4 ${rowClassName}`}>
          <div className="flex items-center gap-4">
            <SkeletonBar className="h-10 w-10 flex-none rounded-ll-md" />
            <div className="flex-1 space-y-2">
              <SkeletonBar className="h-4 w-2/3 max-w-sm" />
              <SkeletonBar className="h-3 w-1/2 max-w-xs" />
            </div>
            <SkeletonBar className="hidden h-4 w-16 sm:block" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function DashboardOverviewSkeleton() {
  return (
    <div role="status" aria-label="Loading dashboard">
      <TopbarSkeleton />
      <div className="space-y-8 p-8">
        <StatCardsSkeleton />
        <div className="ll-panel overflow-hidden">
          <div className="ll-panel-header">
            <SkeletonBar className="h-5 w-40" />
            <SkeletonBar className="h-4 w-20" />
          </div>
          <ListRowsSkeleton rows={5} />
        </div>
        <SkeletonBar className="min-h-[12rem] w-full rounded-ll-lg" />
      </div>
      <span className="sr-only">Loading dashboard...</span>
    </div>
  );
}

export function DashboardLinksSkeleton() {
  return (
    <div role="status" aria-label="Loading links">
      <TopbarSkeleton actionWidth="w-64" />
      <div className="p-8">
        <div className="ll-panel overflow-hidden">
          <div className="ll-panel-header">
            <SkeletonBar className="h-5 w-48" />
            <SkeletonBar className="h-4 w-24" />
          </div>
          <ListRowsSkeleton rows={10} rowClassName="min-h-[6.5rem]" />
          <div className="flex items-center justify-between border-t border-ll-border px-6 py-4">
            <SkeletonBar className="h-4 w-40" />
            <div className="flex gap-2">
              <SkeletonBar className="h-9 w-20 rounded-ll-md" />
              <SkeletonBar className="h-9 w-16 rounded-ll-md" />
            </div>
          </div>
        </div>
      </div>
      <span className="sr-only">Loading links...</span>
    </div>
  );
}

export function DashboardBackupsSkeleton() {
  return (
    <div role="status" aria-label="Loading cloud snapshots">
      <header className="ll-topbar">
        <SkeletonBar className="h-7 w-52" />
      </header>
      <div className="p-8">
        <div className="mb-8 max-w-3xl space-y-2">
          <SkeletonBar className="h-6 w-64" />
          <SkeletonBar className="h-4 w-full" />
          <SkeletonBar className="h-4 w-5/6" />
        </div>
        <div className="ll-panel max-w-4xl overflow-hidden">
          <div className="ll-panel-header">
            <SkeletonBar className="h-5 w-40" />
            <SkeletonBar className="h-4 w-36" />
          </div>
          <ListRowsSkeleton rows={4} rowClassName="min-h-[5.5rem]" />
        </div>
      </div>
      <span className="sr-only">Loading cloud snapshots...</span>
    </div>
  );
}

export function DashboardBillingSkeleton() {
  return (
    <div role="status" aria-label="Loading billing">
      <header className="ll-topbar">
        <SkeletonBar className="h-7 w-24" />
      </header>
      <div className="mx-auto max-w-4xl space-y-6 p-8">
        <div className="ll-panel min-h-[28rem] p-8">
          <SkeletonBar className="h-6 w-32 rounded-full" />
          <SkeletonBar className="mt-5 h-4 w-24" />
          <SkeletonBar className="mt-2 h-9 w-40" />
          <SkeletonBar className="mt-3 h-4 w-full max-w-2xl" />
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className="min-h-[5.5rem] rounded-ll-lg border border-ll-border bg-ll-card p-4"
                aria-hidden="true"
              >
                <SkeletonBar className="h-3 w-16" />
                <SkeletonBar className="mt-3 h-5 w-28" />
              </div>
            ))}
          </div>
          <div className="mt-8 grid grid-cols-1 gap-4 border-t border-ll-border pt-6 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="min-h-[7rem] rounded-ll-lg border border-ll-border bg-ll-card p-5"
                aria-hidden="true"
              >
                <SkeletonBar className="h-5 w-40" />
                <SkeletonBar className="mt-3 h-4 w-full" />
                <SkeletonBar className="mt-2 h-4 w-5/6" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <span className="sr-only">Loading billing...</span>
    </div>
  );
}

export function DashboardDevicesSkeleton() {
  return (
    <div role="status" aria-label="Loading devices">
      <header className="ll-topbar">
        <SkeletonBar className="h-7 w-28" />
      </header>
      <div className="mx-auto max-w-4xl p-8">
        <div className="mb-8 space-y-2">
          <SkeletonBar className="h-6 w-40" />
          <SkeletonBar className="h-4 w-full max-w-xl" />
        </div>
        <div className="ll-panel overflow-hidden">
          <ListRowsSkeleton rows={3} rowClassName="min-h-[5.5rem] px-6 py-6" />
        </div>
      </div>
      <span className="sr-only">Loading devices...</span>
    </div>
  );
}
