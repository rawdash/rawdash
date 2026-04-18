import { Badge, Card, Text } from '@tremor/react';

const STATUS_COLORS: Record<string, 'green' | 'red' | 'yellow' | 'gray'> = {
  success: 'green',
  failure: 'red',
  cancelled: 'yellow',
  skipped: 'gray',
};

interface StatusWidgetProps {
  label: string;
  value: string;
}

export function StatusWidget({ label, value }: StatusWidgetProps) {
  const color = STATUS_COLORS[value] ?? 'gray';
  const display = value.replace(/_/g, ' ');

  return (
    <Card>
      <Text>{label}</Text>
      <div className="mt-2">
        <Badge color={color} size="xl">
          {display}
        </Badge>
      </div>
    </Card>
  );
}
