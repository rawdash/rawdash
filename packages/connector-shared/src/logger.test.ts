import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createDefaultConnectorLogger,
  formatLogFields,
  formatLogLine,
} from './logger';

describe('formatLogFields', () => {
  it('renders nothing when no fields', () => {
    expect(formatLogFields()).toBe('');
    expect(formatLogFields({})).toBe('');
  });

  it('skips undefined values', () => {
    expect(formatLogFields({ a: 1, b: undefined, c: 'x' })).toBe(' a=1 c=x');
  });

  it('quotes strings with spaces or equals', () => {
    expect(formatLogFields({ msg: 'hello world' })).toBe(' msg="hello world"');
    expect(formatLogFields({ key: 'a=b' })).toBe(' key="a=b"');
  });

  it('serializes objects as JSON and truncates long values', () => {
    const long = 'x'.repeat(200);
    const out = formatLogFields({ long });
    expect(out.length).toBeLessThan(200);
    expect(out).toContain('…');
  });

  it('renders null and primitives', () => {
    expect(formatLogFields({ a: null, b: true, c: 3 })).toBe(
      ' a=null b=true c=3',
    );
  });
});

describe('formatLogLine', () => {
  it('prefixes with scope', () => {
    expect(formatLogLine('github', 'fetched page', { items: 5 })).toBe(
      '[github] fetched page items=5',
    );
  });
});

describe('createDefaultConnectorLogger', () => {
  const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  afterEach(() => {
    infoSpy.mockClear();
    warnSpy.mockClear();
  });

  it('emits info via console.info with scope prefix', () => {
    const logger = createDefaultConnectorLogger({ scope: 'github' });
    logger.info('hello', { a: 1 });
    expect(infoSpy).toHaveBeenCalledWith('[github] hello a=1');
  });

  it('emits warn via console.warn', () => {
    const logger = createDefaultConnectorLogger({ scope: 'sentry' });
    logger.warn('boom', { error: 'oops' });
    expect(warnSpy).toHaveBeenCalledWith('[sentry] boom error=oops');
  });
});
