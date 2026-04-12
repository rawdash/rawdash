interface StatWidgetProps {
  label: string;
  value: number;
  unit?: string;
}

export function StatWidget({ label, value, unit }: StatWidgetProps) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-5 shadow-sm">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-3xl font-bold leading-none">
        {String(value)}
        {unit && (
          <span className="ml-1 text-xl font-medium text-muted-foreground">
            {unit}
          </span>
        )}
      </span>
    </div>
  );
}
