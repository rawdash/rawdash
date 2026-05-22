import type { DashboardConfig, ServerStorage } from '@rawdash/server';
import { InMemoryStorage, ROUTES } from '@rawdash/server';
import { Hono } from 'hono';

import { createHealthRouter } from './health';
import { createRetentionRouter, startRetentionLoop } from './retention';
import { createSyncRouter, createSyncStateRouter } from './sync';
import { createWidgetsRouter } from './widgets';

export interface MountEngineOptions {
  storage?: ServerStorage;
  /** Set false to skip the background retention timer (e.g. on serverless). */
  startRetention?: boolean;
}

export interface MountEngineResult {
  app: Hono;
  stop(): void;
}

/**
 * Convenience wrapper for the common case: builds a Hono app with all
 * standard rawdash routes mounted at their canonical paths, backed by
 * one `DashboardConfig` and one `ServerStorage` (defaults to
 * `InMemoryStorage`).
 *
 * For deployments that need auth or that look up config / storage per
 * request, skip this and compose the router factories directly with
 * per-request `getConfig` / `getStorage` and `before` middleware.
 */
export function mountEngine(
  config: DashboardConfig,
  options: MountEngineOptions = {},
): MountEngineResult {
  const storage: ServerStorage = options.storage ?? new InMemoryStorage();
  const getConfig = (): DashboardConfig => config;
  const getStorage = (): ServerStorage => storage;

  const app = new Hono();
  app.route('/dashboards', createWidgetsRouter({ getConfig, getStorage }));
  app.route(ROUTES.sync, createSyncRouter({ getConfig, getStorage }));
  app.route(ROUTES.syncState, createSyncStateRouter({ getStorage }));
  app.route('/retention', createRetentionRouter({ getConfig, getStorage }));
  app.route(ROUTES.health, createHealthRouter());

  let stopRetention: (() => void) | null = null;
  if (options.startRetention !== false) {
    stopRetention = startRetentionLoop({ getConfig, getStorage });
  }

  return {
    app,
    stop() {
      if (stopRetention) {
        stopRetention();
      }
    },
  };
}
