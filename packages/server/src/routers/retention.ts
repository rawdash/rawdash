import type { DashboardConfig, RetentionConfig } from '@rawdash/core';
import { selectForDeletion } from '@rawdash/core';
import type { Hono } from 'hono';

import type { RawdashRouter } from '../router';
import type { ServerStorage } from '../types';

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

function hasPruningPolicy(config: RetentionConfig): boolean {
  return config.maxAge !== undefined || config.maxSize !== undefined;
}

export class RetentionRouter implements RawdashRouter {
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private config: DashboardConfig,
    private storage: ServerStorage,
  ) {}

  async runRetention(): Promise<void> {
    const retentionConfig = this.config.retention;
    if (!retentionConfig || !hasPruningPolicy(retentionConfig)) {
      return;
    }

    const nowMs = Date.now();

    const results = await Promise.allSettled(
      this.config.connectors.map(async ({ connector }) => {
        const handle = this.storage.getStorageHandle(connector.id);

        const [events, metrics, distributions] = await Promise.all([
          handle.queryEvents({}),
          handle.queryMetrics({}),
          handle.queryDistributions({}),
        ]);

        await applyRetentionToShape(
          events,
          (e) => e.start_ts,
          retentionConfig,
          nowMs,
          (survivors, names) => handle.events(survivors, { names }),
        );

        await applyRetentionToShape(
          metrics,
          (m) => m.ts,
          retentionConfig,
          nowMs,
          (survivors, names) => handle.metrics(survivors, { names }),
        );

        await applyRetentionToShape(
          distributions,
          (d) => d.ts,
          retentionConfig,
          nowMs,
          (survivors, names) => handle.distributions(survivors, { names }),
        );
      }),
    );

    const failures = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    if (failures.length > 0) {
      throw new Error(
        `Retention failed for ${failures.length} connector(s): ${failures.map((f) => String(f.reason)).join('; ')}`,
      );
    }
  }

  mount(app: Hono): void {
    app.post('/retain', async (c) => {
      try {
        await this.runRetention();
        return c.json({ triggered: true });
      } catch (err) {
        console.error('retention run failed', err);
        return c.json({ triggered: false }, 500);
      }
    });

    const retentionConfig = this.config.retention;
    if (retentionConfig && hasPruningPolicy(retentionConfig)) {
      const intervalMs = retentionConfig.intervalMs ?? DEFAULT_INTERVAL_MS;
      this.interval = setInterval(() => {
        void this.runRetention().catch((err) => {
          console.error('retention run failed', err);
        });
      }, intervalMs);
    }
  }

  stop(): void {
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}

async function applyRetentionToShape<T extends { name: string }>(
  rows: T[],
  getTs: (row: T) => number,
  config: RetentionConfig,
  nowMs: number,
  writeSurvivors: (survivors: T[], names: string[]) => Promise<void>,
): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const sorted = [...rows].sort((a, b) => getTs(b) - getTs(a));
  const toDeleteSet = new Set(selectForDeletion(sorted, getTs, config, nowMs));

  if (toDeleteSet.size === 0) {
    return;
  }

  const survivors = sorted.filter((r) => !toDeleteSet.has(r));
  const allNames = [...new Set(rows.map((r) => r.name))];

  await writeSurvivors(survivors, allNames);
}
