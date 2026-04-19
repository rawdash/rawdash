interface StatWidgetProps {
  label: string;
  value: number;
  unit?: string;
  trend?: number;
}

export function StatWidget({ label, value, unit, trend }: StatWidgetProps) {
  const trendColor =
    trend === undefined
      ? null
      : trend > 0
        ? 'text-emerald-600'
        : trend < 0
          ? 'text-red-500'
          : 'text-gray-400';

  const trendArrow =
    trend === undefined ? null : trend > 0 ? '▲' : trend < 0 ? '▼' : '–';

  return (
    <div className="flex flex-col justify-between gap-3 rounded-xl border border-gray-100 bg-white px-5 py-4 shadow-sm sm:px-6 sm:py-5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">
          {label}
        </span>
        {trend !== undefined && trendColor && trendArrow && (
          <span className={`shrink-0 text-xs font-semibold ${trendColor}`}>
            {trendArrow} {Math.abs(trend).toLocaleString()}
          </span>
        )}
      </div>
      <span className="text-4xl font-extrabold tabular-nums tracking-tight text-gray-900 sm:text-5xl">
        {value.toLocaleString()}
        {unit && (
          <span className="ml-1 text-xl font-medium text-gray-400 sm:text-2xl">
            {unit}
          </span>
        )}
      </span>
    </div>
  );
}
