import { type Client, createClient } from '@libsql/client';
import { LibsqlStorage } from '@rawdash/adapter-libsql';
import type {
  ConnectorHealth,
  GetStorageHandleOptions,
  MarkSyncSucceededOptions,
  ServerStorage,
  StorageHandle,
  SyncState,
} from '@rawdash/core';
import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface SqliteStorageOptions {
  ensureDir?: boolean;
}

function toFileUrl(path: string): string {
  if (path === ':memory:') {
    return ':memory:';
  }
  const absolute = isAbsolute(path) ? path : resolve(process.cwd(), path);
  return pathToFileURL(absolute).toString();
}

function makeClient(path: string, ensureDir: boolean): Client {
  if (ensureDir && path !== ':memory:') {
    const absolute = isAbsolute(path) ? path : resolve(process.cwd(), path);
    mkdirSync(dirname(absolute), { recursive: true });
  }
  return createClient({ url: toFileUrl(path) });
}

export class SqliteStorage implements ServerStorage {
  private inner: LibsqlStorage;

  constructor(path: string, options: SqliteStorageOptions = {}) {
    const ensureDir = options.ensureDir ?? true;
    const client = makeClient(path, ensureDir);
    this.inner = new LibsqlStorage({ client });
  }

  waitUntilReady(): Promise<void> {
    return this.inner.waitUntilReady();
  }

  getStorageHandle(
    connectorId: string,
    options?: GetStorageHandleOptions,
  ): StorageHandle {
    return this.inner.getStorageHandle(connectorId, options);
  }

  getHealth(connectorId: string): Promise<ConnectorHealth | null> {
    return this.inner.getHealth(connectorId);
  }

  getSyncState(): Promise<SyncState> {
    return this.inner.getSyncState();
  }

  markSyncQueued(): Promise<boolean> {
    return this.inner.markSyncQueued();
  }

  markSyncRunning(): Promise<boolean> {
    return this.inner.markSyncRunning();
  }

  markSyncSucceeded(options?: MarkSyncSucceededOptions): Promise<void> {
    return this.inner.markSyncSucceeded(options);
  }

  markSyncFailed(error: string): Promise<void> {
    return this.inner.markSyncFailed(error);
  }

  close(): Promise<void> {
    return this.inner.close();
  }
}
