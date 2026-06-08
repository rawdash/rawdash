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
