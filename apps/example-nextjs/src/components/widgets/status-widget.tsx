const STATUS_COLORS: Record<string, string> = {
  success: 'text-green-600',
  failure: 'text-red-600',
  cancelled: 'text-yellow-600',
  skipped: 'text-muted-foreground',
};

interface StatusWidgetProps {
  label: string;
  value: string;
}

export function StatusWidget({ label, value }: StatusWidgetProps) {
  const colorClass = STATUS_COLORS[value] ?? 'text-foreground';

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-5 shadow-sm">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span
        className={`text-2xl font-bold capitalize leading-none ${colorClass}`}
      >
        {value.replace(/_/g, ' ')}
      </span>
    </div>
  );
}
