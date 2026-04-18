const STATUS_STYLES: Record<string, { dot: string; text: string }> = {
  success: { dot: 'bg-emerald-500', text: 'text-emerald-700' },
  failure: { dot: 'bg-red-500', text: 'text-red-700' },
  cancelled: { dot: 'bg-amber-500', text: 'text-amber-700' },
  skipped: { dot: 'bg-gray-400', text: 'text-gray-500' },
};

interface StatusWidgetProps {
  label: string;
  value: string;
}

export function StatusWidget({ label, value }: StatusWidgetProps) {
  const styles = STATUS_STYLES[value] ?? {
    dot: 'bg-gray-400',
    text: 'text-gray-700',
  };

  return (
    <div className="flex min-h-[120px] flex-col justify-between rounded-lg border border-gray-200 bg-white px-6 py-5 shadow-sm">
      <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">
        {label}
      </span>
      <div className="flex items-center gap-2.5">
        <span className={`h-3 w-3 shrink-0 rounded-full ${styles.dot}`} />
        <span className={`text-3xl font-bold capitalize ${styles.text}`}>
          {value.replace(/_/g, ' ')}
        </span>
      </div>
    </div>
  );
}
