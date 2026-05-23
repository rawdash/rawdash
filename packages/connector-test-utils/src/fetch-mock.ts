import type { InMemoryStorage } from '@rawdash/core';
import { vi } from 'vitest';

export interface MockResponseInit {
  body: unknown;
  status?: number;
  headers?: Record<string, string>;
}

export function mockResponse(init: MockResponseInit): Response {
  const { body, status = 200, headers = {} } = init;
  const mergedHeaders = new Headers({
    'content-type': 'application/json',
    ...headers,
  });
  return new Response(JSON.stringify(body ?? null), {
    status,
    headers: mergedHeaders,
  });
}

export function mockJsonResponse(body: unknown): Response {
  return mockResponse({ body });
}

export function installFetchMock(
  routeBody: (url: string) => unknown,
): ReturnType<typeof vi.fn> {
  const spy = vi.fn().mockImplementation((url: string | URL) => {
    const u = typeof url === 'string' ? url : url.toString();
    return Promise.resolve(mockJsonResponse(routeBody(u)));
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

export function installFetchMockAdvanced(
  routeBody: (url: string) => MockResponseInit,
): ReturnType<typeof vi.fn> {
  const spy = vi.fn().mockImplementation((url: string | URL) => {
    const u = typeof url === 'string' ? url : url.toString();
    return Promise.resolve(mockResponse(routeBody(u)));
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

export function entityStoreFor<E = { type: string; id: string }>(
  storage: InMemoryStorage,
  connectorId: string,
): Map<string, Map<string, E>> {
  return (
    (
      storage as unknown as {
        entityStore: Map<string, Map<string, Map<string, E>>>;
      }
    ).entityStore.get(connectorId) ?? new Map()
  );
}

export function eventStoreFor<E = { name: string }>(
  storage: InMemoryStorage,
  connectorId: string,
): E[] {
  return (
    ((
      storage as unknown as { eventStore: Map<string, unknown[]> }
    ).eventStore.get(connectorId) as E[] | undefined) ?? []
  );
}

export function metricStoreFor<M = { name: string; ts: number; value: number }>(
  storage: InMemoryStorage,
  connectorId: string,
): M[] {
  return (
    ((
      storage as unknown as { metricStore: Map<string, unknown[]> }
    ).metricStore.get(connectorId) as M[] | undefined) ?? []
  );
}
