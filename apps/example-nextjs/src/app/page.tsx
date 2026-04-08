export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-muted-foreground">
          Your connected data sources at a glance.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-40 rounded-lg border border-dashed border-border bg-muted/30 flex items-center justify-center"
          >
            <span className="text-sm text-muted-foreground">
              Widget placeholder
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
