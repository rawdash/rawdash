import type { EngineContext } from '@rawdash/server';
import type { DashboardConfig, ServerStorage } from '@rawdash/server';
import { isRawdashError } from '@rawdash/server';
import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono';

export interface HonoRouterOptions {
  getConfig: (c: Context) => DashboardConfig | Promise<DashboardConfig>;
  getStorage: (c: Context) => ServerStorage | Promise<ServerStorage>;
  before?: MiddlewareHandler[];
}

export interface HonoStorageRouterOptions {
  getStorage: (c: Context) => ServerStorage | Promise<ServerStorage>;
  before?: MiddlewareHandler[];
}

export function makeEngineContext(
  c: Context,
  opts: HonoRouterOptions,
): EngineContext {
  return {
    getConfig: () => opts.getConfig(c),
    getStorage: () => opts.getStorage(c),
  };
}

export function applyBefore(app: Hono, before?: MiddlewareHandler[]): void {
  if (!before) {
    return;
  }
  for (const mw of before) {
    app.use('*', mw);
  }
}

export function mapError(c: Context, err: unknown): Response {
  if (isRawdashError(err)) {
    return c.json(
      { error: err.message, code: err.code },
      err.status as Parameters<typeof c.json>[1],
    );
  }
  throw err;
}
