'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { StaleBadge } from './stale-badge';

interface TooltipPayloadItem {
  value: number;
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
      <p className="text-sm font-semibold text-gray-900">{payload[0]?.value}</p>
    </div>
  );
}

interface TimeseriesEntry {
  date: string;
  count: number;
}

interface TimeseriesWidgetProps {
  label: string;
  entries: TimeseriesEntry[];
  stale?: boolean;
}

export function TimeseriesWidget({
  label,
  entries,
  stale,
}: TimeseriesWidgetProps) {
  const data = entries.map((e) => {
    const d = new Date(e.date);
    const formatted = !isNaN(d.getTime())
      ? `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
      : e.date.slice(5, 10);
    return { date: formatted, value: e.count };
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
            <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.12} />
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
            </linearGradient>
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
          <Area
            type="monotone"
            dataKey="value"
            stroke="#6366f1"
            strokeWidth={2}
            fill="url(#areaGradient)"
            dot={false}
            activeDot={{
              r: 4,
              fill: '#6366f1',
              stroke: 'white',
              strokeWidth: 2,
            }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
