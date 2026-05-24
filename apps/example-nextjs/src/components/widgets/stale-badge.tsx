export function StaleBadge() {
  return (
    <span
      title="Showing previously synced value — most recent sync did not succeed"
      className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-amber-700"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      Stale
    </span>
  );
}
