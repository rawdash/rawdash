import type {
  AggregateRequest,
  ConnectorRegistry,
  DashboardConfig,
  SecretsResolver,
  ServerStorage,
  Widget,
} from '@rawdash/core';
import {
  classifyWidget,
  computeConnectorBackfill,
  instantiateConnector,
  writeAggregate,
} from '@rawdash/core';

export const FULL_SYNC_TIMEOUT_MS = 300_000;
export const FULL_SYNC_MAX_CHUNKS = 1_000;
export const BACKFILL_BUFFER_MS = 86_400_000;

export interface RunSyncOptions {
  connectorRegistry: ConnectorRegistry;
  secretsResolver?: SecretsResolver;
}

/**
 * Run a full sync across all connectors in the config in parallel via
 * `Promise.allSettled`, so one failure doesn't abort the others. Each
 * connector run is wrapped in a hard timeout (`FULL_SYNC_TIMEOUT_MS`)
 * raced against the connector's own `Promise`, so a connector that
 * ignores `AbortSignal` (or a storage call that hangs) can still not
 * pin sync state in `running` indefinitely.
 *
 * Connectors that return `{ done: false, cursor }` are looped in-process,
 * threading the cursor back into the next `sync` call until `done: true`
 * or the shared timeout / `FULL_SYNC_MAX_CHUNKS` cap fires. Cloud
 * deployments layer cross-restart cursor persistence on top of the same
 * contract; the OSS runner is the trivial in-process case.
 *
 * The per-run storage handle is bound to the same `AbortController`, so
 * once the timeout fires every subsequent write call on that handle
 * becomes a no-op. That makes tail writes from a timed-out connector
 * invisible to the next sync even if the connector itself keeps running
 * — see `withAbortSignal` in `@rawdash/core` and the safety-net note in
 * `docs/authoring-a-connector.md`.
 *
 * Transitions storage through `queued` → `running` → `succeeded`/`failed`.
 * The `queued` step is a no-op if the caller (typically `triggerSync`)
 * already marked the run as queued.
 *
 * Returns silently if another sync acquired the `running` lock first.
 */
interface WidgetForConnector {
  dashboardId: string;
  widgetId: string;
  widget: Widget;
  resource: string | undefined;
  aggregateRequest: AggregateRequest | undefined;
}

function widgetsForConnector(
  config: DashboardConfig,
  connectorName: string,
): WidgetForConnector[] {
  const out: WidgetForConnector[] = [];
  for (const [dashboardId, dashboard] of Object.entries(config.dashboards)) {
    for (const [widgetId, widget] of Object.entries(dashboard.widgets)) {
      if (widget.kind === 'status') {
        continue;
      }
      if (widget.metric.connectorId !== connectorName) {
        continue;
      }
      const classification = classifyWidget(widget);
      out.push({
        dashboardId,
        widgetId,
        widget,
        resource: widget.metric.name ?? widget.metric.entityType,
        aggregateRequest:
          classification.via === 'aggregate'
            ? classification.request
            : undefined,
      });
    }
  }
  return out;
}

export async function runSync(
  config: DashboardConfig,
  storage: ServerStorage,
  options: RunSyncOptions,
): Promise<void> {
  await storage.markSyncQueued();
  if (typeof storage.markSyncRunning === 'function') {
    const acquired = await storage.markSyncRunning();
    if (!acquired) {
      return;
    }
  }
  const errors: string[] = [];
  const backfill = computeConnectorBackfill(config);
  const now = Date.now();
  await Promise.allSettled(
    config.connectors.map(async (entry) => {
      if (entry.enabled === false) {
        return;
      }
      const scope = backfill.get(entry.name);
      if (!scope) {
        return;
      }
      const controller = new AbortController();
      const handle = storage.getStorageHandle(entry.name, {
        signal: controller.signal,
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const connector = instantiateConnector(
          entry,
          options.connectorRegistry,
          options.secretsResolver,
        );
        const timeoutPromise = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            const err = new Error(
              `${entry.name} timed out after ${FULL_SYNC_TIMEOUT_MS}ms`,
            );
            err.name = 'AbortError';
            reject(err);
          }, FULL_SYNC_TIMEOUT_MS);
        });

        const widgets = widgetsForConnector(config, entry.name);
        // Track per-resource aggregate eligibility and success so we only
        // drop a resource from entity sync once every aggregate-eligible
        // widget targeting it has actually completed successfully. A failed
        // (or unsupported) aggregate call must NOT silently skip the entity
        // sync that would otherwise have populated the widget's data.
        const aggregateCounts = new Map<
          string,
          { eligible: number; succeeded: number }
        >();
        const entitySyncResources = new Set<string>();
        const eligible: Array<
          WidgetForConnector & { aggregateRequest: AggregateRequest }
        > = [];
        for (const w of widgets) {
          if (w.resource === undefined) {
            continue;
          }
          if (w.aggregateRequest && connector.aggregate) {
            eligible.push(
              w as WidgetForConnector & {
                aggregateRequest: AggregateRequest;
              },
            );
            const c = aggregateCounts.get(w.resource) ?? {
              eligible: 0,
              succeeded: 0,
            };
            c.eligible += 1;
            aggregateCounts.set(w.resource, c);
          } else {
            entitySyncResources.add(w.resource);
          }
        }

        if (eligible.length > 0) {
          const aggregateCalls = eligible.map(async (w) => {
            try {
              const value = await Promise.race([
                connector.aggregate!(w.aggregateRequest, controller.signal),
                timeoutPromise,
              ]);
              await writeAggregate(handle, w.dashboardId, w.widgetId, value);
              if (w.resource !== undefined) {
                aggregateCounts.get(w.resource)!.succeeded += 1;
              }
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              errors.push(
                `${entry.name} aggregate (${w.dashboardId}:${w.widgetId}): ${message}`,
              );
            }
          });
          await Promise.all(aggregateCalls);
        }

        const aggregateServedResources = new Set<string>();
        for (const [resource, { eligible: e, succeeded }] of aggregateCounts) {
          if (entitySyncResources.has(resource)) {
            continue;
          }
          if (e === succeeded) {
            aggregateServedResources.add(resource);
          }
        }

        const resources: ReadonlySet<string> = new Set(
          [...scope.keys()].filter((r) => !aggregateServedResources.has(r)),
        );
        // Skip entity sync entirely when every resource the connector would
        // have synced is now aggregate-served. Connectors with no resources
        // to begin with (status-widget-only) still run sync to refresh health.
        if (scope.size > 0 && resources.size === 0) {
          return;
        }

        let maxWindowMs: number | undefined;
        for (const [resourceName, { requiredWindowMs }] of scope.entries()) {
          if (!resources.has(resourceName)) {
            continue;
          }
          if (requiredWindowMs === undefined) {
            continue;
          }
          if (maxWindowMs === undefined || requiredWindowMs > maxWindowMs) {
            maxWindowMs = requiredWindowMs;
          }
        }
        const since =
          maxWindowMs !== undefined
            ? new Date(now - maxWindowMs - BACKFILL_BUFFER_MS).toISOString()
            : undefined;

        let cursor: unknown = undefined;
        let chunks = 0;
        while (true) {
          chunks += 1;
          if (chunks > FULL_SYNC_MAX_CHUNKS) {
            controller.abort();
            throw new Error(
              `${entry.name} exceeded ${FULL_SYNC_MAX_CHUNKS} sync chunks without completing`,
            );
          }
          const syncPromise = connector.sync(
            { mode: 'full', since, cursor, resources },
            handle,
            controller.signal,
          );
          const result = await Promise.race([syncPromise, timeoutPromise]);
          if (result.done) {
            break;
          }
          cursor = result.cursor;
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          errors.push(
            `${entry.name} timed out after ${FULL_SYNC_TIMEOUT_MS}ms`,
          );
        } else {
          errors.push(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
      }
    }),
  );
  if (errors.length > 0) {
    await storage.markSyncFailed(errors.join('; '));
  } else {
    await storage.markSyncSucceeded();
  }
}
