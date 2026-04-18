import { BarChart } from '@tremor/react';

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
    <div className="col-span-full rounded-lg border border-gray-200 bg-white px-6 py-5 shadow-sm">
      <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">
        {label}
      </span>
      <BarChart
        className="mt-4 h-36"
        data={data}
        index="date"
        categories={['Runs']}
        colors={['indigo']}
        showLegend={false}
        showYAxis={true}
        showGridLines={true}
        showAnimation={true}
        yAxisWidth={32}
        minValue={0}
      />
    </div>
  );
}
