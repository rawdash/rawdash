import { Card, Metric, Text } from '@tremor/react';

interface StatWidgetProps {
  label: string;
  value: number;
  unit?: string;
}

export function StatWidget({ label, value, unit }: StatWidgetProps) {
  return (
    <Card>
      <Text>{label}</Text>
      <Metric>
        {String(value)}
        {unit && (
          <span className="ml-1 text-xl font-medium text-tremor-content">
            {unit}
          </span>
        )}
      </Metric>
    </Card>
  );
}
