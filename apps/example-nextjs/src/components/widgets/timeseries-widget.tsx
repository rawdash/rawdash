interface TimeseriesEntry {
  date: string;
  count: number;
}

interface TimeseriesWidgetProps {
  label: string;
  entries: TimeseriesEntry[];
}

export function TimeseriesWidget({ label, entries }: TimeseriesWidgetProps) {
  const maxCount = Math.max(...entries.map((e) => e.count), 1);

  return (
    <div className="col-span-full flex flex-col gap-3 rounded-lg border border-border bg-card p-5 shadow-sm">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-col gap-1">
        <div className="flex items-end gap-2" style={{ height: '64px' }}>
          {entries.map((entry) => {
            const barHeight = Math.max(
              2,
              Math.round((entry.count / maxCount) * 64),
            );
            return (
              <div
                key={entry.date}
                className="relative flex flex-1 justify-center"
                title={String(entry.count)}
              >
                <div
                  className="w-full rounded-t bg-primary transition-all"
                  style={{ height: `${barHeight}px` }}
                />
              </div>
            );
          })}
        </div>
        <div className="flex gap-2">
          {entries.map((entry) => (
            <span
              key={entry.date}
              className="flex-1 text-center text-[10px] text-muted-foreground"
            >
              {entry.date.slice(5)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
