import { StaleBadge } from './stale-badge';

interface NoDataWidgetProps {
  label: string;
  stale?: boolean;
}

export function NoDataWidget({ label, stale }: NoDataWidgetProps) {
  return (
    <div className="flex flex-col justify-between gap-3 rounded-xl border border-dashed border-gray-200 bg-gray-50/40 px-5 py-4 shadow-sm sm:px-6 sm:py-5">
      <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-gray-400">
        {label}
        {stale && <StaleBadge />}
      </span>
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-gray-300" />
        <span
          title="The query matched no underlying rows — not a real zero"
          className="text-sm font-medium text-gray-500"
        >
          No matching data
        </span>
      </div>
    </div>
  );
}
