import type { DashboardConfig } from '@rawdash/core';
import type { Hono } from 'hono';

import type { RawdashRouter } from '../router';
import type { InMemoryStorage } from '../storage';

const FULL_SYNC_TIMEOUT_MS = 300_000;

export class SyncRouter implements RawdashRouter {
  constructor(
    private config: DashboardConfig,
    private storage: InMemoryStorage,
  ) {}

  private async withTimeout<T>(
    promise: Promise<T>,
    label: string,
    timeoutMs: number,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  async runSync(): Promise<void> {
    if (this.storage.getSyncState().status === 'syncing') {
      return;
    }
    this.storage.setSyncing();
    const errors: string[] = [];
    const results = await Promise.allSettled(
      this.config.connectors.map(async ({ connector }) => {
        const handle = this.storage.getStorageHandle(connector.id);
        try {
          await this.withTimeout(
            connector.sync({ mode: 'full' }, handle),
            connector.id,
            FULL_SYNC_TIMEOUT_MS,
          );
        } catch (err) {
          errors.push(err instanceof Error ? err.message : String(err));
        }
      }),
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        errors.push(
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
        );
      }
    }
    if (errors.length > 0) {
      this.storage.setSyncError(errors.join('; '));
    } else {
      this.storage.setSyncSuccess();
    }
  }

  mount(app: Hono): void {
    app.post('/sync', async (c) => {
      if (this.storage.getSyncState().status === 'syncing') {
        return c.json({ triggered: false });
      }
      void this.runSync();
      return c.json({ triggered: true });
    });
  }
}
