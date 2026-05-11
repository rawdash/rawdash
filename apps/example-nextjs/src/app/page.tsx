import { WidgetCard } from '@/components/widgets/widget-card';
import { rawdash } from '@/lib/rawdash';

export const revalidate = 60;

export default async function DashboardPage() {
  await rawdash.ensureFresh(60_000).catch((err: unknown) => {
    console.error('rawdash.ensureFresh failed', err);
  });
  const widgets = await rawdash.getWidgets('github').catch((err: unknown) => {
    console.error('rawdash.getWidgets failed', err);
    return [];
  });

  if (widgets.length === 0) {
    return (
      <div className="flex h-[calc(100vh-3rem)] items-center justify-center">
        <span className="text-sm text-gray-400">
          No data yet — sync is in progress.
        </span>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {widgets.map((w) => (
          <WidgetCard key={`${w.connectorId}:${w.widgetId}`} widget={w} />
        ))}
      </div>
    </div>
  );
}
