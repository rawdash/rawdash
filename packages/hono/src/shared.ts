import type { EngineContext } from '@rawdash/server';
import type { DashboardConfig, ServerStorage } from '@rawdash/server';
import { isRawdashError } from '@rawdash/server';
import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono';

/**
 * Common options accepted by every `@rawdash/hono` router factory.
 *
 * `getConfig` / `getStorage` are invoked per-request with the Hono
 * `Context`, so adapters can derive the config or storage from request
 * state (e.g. a path parameter, an id attached by an auth middleware, or
 * environment bindings).
 *
 * `before` middleware runs before any handler — typically auth/scope
 * checks.
 */
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

/**
 * Translate a thrown error into a Hono JSON response. `RawdashError`
 * becomes a structured `{error, code}` body at the carried status; any
 * other error is re-thrown for Hono's own error handling.
 */
export function mapError(c: Context, err: unknown): Response {
  if (isRawdashError(err)) {
    return c.json(
      { error: err.message, code: err.code },
      err.status as Parameters<typeof c.json>[1],
    );
  }
  throw err;
}
