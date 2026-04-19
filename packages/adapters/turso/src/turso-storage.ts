import { createClient } from '@libsql/client';
import type { Client } from '@libsql/client';
import type { StorageHandle } from '@rawdash/core';
import type { ServerStorage, SyncState } from '@rawdash/server';

export interface TursoStorageOptions {
  url: string;
  authToken?: string;
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '_');
}

function tableName(connectorId: string, resource: string): string {
  return `records_${sanitizeName(connectorId)}_${sanitizeName(resource)}`;
}

export class TursoStorage implements ServerStorage {
  private client: Client;
  private syncState: SyncState = {
    status: 'idle',
    lastSyncAt: null,
    lastError: null,
  };

  constructor(options: TursoStorageOptions) {
    this.client = createClient({
      url: options.url,
      authToken: options.authToken,
    });
  }

  getStorageHandle(connectorId: string): StorageHandle {
    return {
      upsert: async (resource, records) => {
        const table = tableName(connectorId, resource);
        await this.client.execute(
          `CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL, ingested_at TEXT NOT NULL)`,
        );
        await this.client.batch(
          [
            { sql: `DELETE FROM ${table}`, args: [] },
            ...records.map((record) => ({
              sql: `INSERT INTO ${table} (data, ingested_at) VALUES (?, ?)`,
              args: [JSON.stringify(record), new Date().toISOString()],
            })),
          ],
          'write',
        );
      },
    };
  }

  async getRecords(
    connectorId: string,
    resource: string,
  ): Promise<Record<string, unknown>[]> {
    const table = tableName(connectorId, resource);
    try {
      const result = await this.client.execute(`SELECT data FROM ${table}`);
      return result.rows.map(
        (row) => JSON.parse(row['data'] as string) as Record<string, unknown>,
      );
    } catch {
      return [];
    }
  }

  getSyncState(): SyncState {
    return { ...this.syncState };
  }

  setSyncing(): void {
    this.syncState = { ...this.syncState, status: 'syncing' };
  }

  setSyncSuccess(): void {
    this.syncState = {
      status: 'idle',
      lastSyncAt: new Date().toISOString(),
      lastError: null,
    };
  }

  setSyncError(error: string): void {
    this.syncState = {
      status: 'error',
      lastSyncAt: this.syncState.lastSyncAt,
      lastError: error,
    };
  }
}
