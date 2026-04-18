'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

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
}

export function TimeseriesWidget({ label, entries }: TimeseriesWidgetProps) {
  const data = entries.map((e) => ({
    date: e.date.slice(5),
    Runs: e.count,
  }));

  return (
    <div className="col-span-full rounded-xl border border-gray-100 bg-white px-6 py-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">
        {label}
      </p>
      <div className="mt-4">
        <ResponsiveContainer width="100%" height={160}>
          <BarChart
            data={data}
            barCategoryGap="40%"
            margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
          >
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
              allowDecimals={false}
            />
            <Tooltip
              content={<CustomTooltip />}
              cursor={{ fill: '#f5f5ff', radius: 4 }}
            />
            <Bar
              dataKey="Runs"
              fill="#6366f1"
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
