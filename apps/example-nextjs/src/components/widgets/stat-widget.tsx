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
    <div className="flex min-h-[120px] flex-col justify-between rounded-lg border border-gray-200 bg-white px-6 py-5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">
          {label}
        </span>
        {trend !== undefined && trendColor && trendArrow && (
          <span className={`shrink-0 text-xs font-semibold ${trendColor}`}>
            {trendArrow} {Math.abs(trend).toLocaleString()}
          </span>
        )}
      </div>
      <span className="text-5xl font-extrabold tabular-nums tracking-tight text-gray-900">
        {value.toLocaleString()}
        {unit && (
          <span className="ml-1 text-2xl font-medium text-gray-400">
            {unit}
          </span>
        )}
      </span>
    </div>
  );
}
