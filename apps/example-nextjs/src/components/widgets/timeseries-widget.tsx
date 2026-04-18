import { BarChart, Card, Text } from '@tremor/react';

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
    count: e.count,
  }));

  return (
    <Card className="col-span-full">
      <Text>{label}</Text>
      <BarChart
        className="mt-4 h-40"
        data={data}
        index="date"
        categories={['count']}
        colors={['blue']}
        showLegend={false}
        showYAxis={false}
        showGridLines={false}
      />
    </Card>
  );
}
