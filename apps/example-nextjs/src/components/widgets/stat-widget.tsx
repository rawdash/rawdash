import { BadgeDelta, Card, Metric, Text } from '@tremor/react';

type DeltaType =
  | 'increase'
  | 'moderateIncrease'
  | 'unchanged'
  | 'moderateDecrease'
  | 'decrease';

function deltaType(delta: number): DeltaType {
  if (delta > 0) return 'increase';
  if (delta < 0) return 'decrease';
  return 'unchanged';
}

interface StatWidgetProps {
  label: string;
  value: number;
  unit?: string;
  trend?: number;
}

export function StatWidget({ label, value, unit, trend }: StatWidgetProps) {
  return (
    <Card>
      <div className="flex items-start justify-between">
        <Text>{label}</Text>
        {trend !== undefined && (
          <BadgeDelta deltaType={deltaType(trend)} size="sm">
            {trend > 0 ? `+${trend}` : String(trend)}
          </BadgeDelta>
        )}
      </div>
      <Metric className="mt-2">
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
