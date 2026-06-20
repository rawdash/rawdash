'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { StaleBadge } from './stale-badge';

const SERIES_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

interface TooltipPayloadItem {
  name?: string;
  value: number;
  color?: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-gray-100 bg-white px-3 py-2 shadow-lg">
      <p className="text-xs text-gray-400">{label}</p>
      {payload.map((item) => (
        <p
          key={item.name ?? 'value'}
          className="text-sm font-semibold text-gray-900"
          style={{ color: item.color }}
        >
          {item.name ? `${item.name}: ` : ''}
          {item.value}
        </p>
      ))}
    </div>
  );
}

interface TimeseriesEntry {
  date: string;
  count: number;
}

interface TimeseriesSeries {
  label: string;
  entries: TimeseriesEntry[];
}

interface TimeseriesWidgetProps {
  label: string;
  entries?: TimeseriesEntry[];
  series?: TimeseriesSeries[];
  stale?: boolean;
}

function formatDate(date: string): string {
  const d = new Date(date);
  return !isNaN(d.getTime())
    ? `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
    : date.slice(5, 10);
}

export function TimeseriesWidget({
  label,
  entries,
  series,
  stale,
}: TimeseriesWidgetProps) {
  const seriesList: TimeseriesSeries[] = series ?? [
    { label: 'value', entries: entries ?? [] },
  ];
  const isMulti = seriesList.length > 1;

  const dateKeys = [
    ...new Set(seriesList.flatMap((s) => s.entries.map((e) => e.date))),
  ].sort();

  const data = dateKeys.map((date) => {
    const row: Record<string, string | number> = { date: formatDate(date) };
    for (const s of seriesList) {
      const match = s.entries.find((e) => e.date === date);
      row[s.label] = match ? match.count : 0;
    }
    return row;
  });

  return (
    <div className="col-span-full rounded-xl border border-gray-100 bg-white px-6 py-5 shadow-sm">
      <p className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-gray-400">
        {label}
        {stale && <StaleBadge />}
      </p>
      <ResponsiveContainer width="100%" height={140}>
        <AreaChart
          data={data}
          margin={{ top: 4, right: 4, bottom: 0, left: -8 }}
        >
          <defs>
            {seriesList.map((s, i) => (
              <linearGradient
                key={s.label}
                id={`areaGradient-${i}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="5%"
                  stopColor={SERIES_COLORS[i % SERIES_COLORS.length]}
                  stopOpacity={0.12}
                />
                <stop
                  offset="95%"
                  stopColor={SERIES_COLORS[i % SERIES_COLORS.length]}
                  stopOpacity={0}
                />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid
            vertical={false}
            stroke="#f3f4f6"
            strokeDasharray="0"
          />
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#9ca3af', fontSize: 11, fontFamily: 'inherit' }}
            dy={6}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#9ca3af', fontSize: 11, fontFamily: 'inherit' }}
            width={28}
            tickCount={4}
            allowDecimals={false}
          />
          <Tooltip
            content={<CustomTooltip />}
            cursor={{ stroke: '#e5e7eb', strokeWidth: 1 }}
          />
          {isMulti && <Legend wrapperStyle={{ fontSize: 11 }} />}
          {seriesList.map((s, i) => (
            <Area
              key={s.label}
              type="monotone"
              dataKey={s.label}
              stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
              strokeWidth={2}
              fill={`url(#areaGradient-${i})`}
              dot={false}
              activeDot={{
                r: 4,
                fill: SERIES_COLORS[i % SERIES_COLORS.length],
                stroke: 'white',
                strokeWidth: 2,
              }}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
