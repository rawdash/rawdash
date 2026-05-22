/**
 * Thrown by `@rawdash/server` handlers when a request fails in a way the
 * HTTP adapter should translate to a structured response (e.g. 404, 400).
 * Framework adapters (`@rawdash/hono`, etc.) should catch this and map
 * `status` to the appropriate HTTP status code.
 */
export class RawdashError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RawdashError';
  }
}

export function isRawdashError(err: unknown): err is RawdashError {
  return err instanceof RawdashError;
}
