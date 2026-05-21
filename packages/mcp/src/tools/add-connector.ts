import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';

import type { McpRuntime } from '../runtime-config';
import type { McpServerOptions } from '../types';
import { err, text } from './shared';

export function registerAddConnector(
  server: McpServer,
  runtime: McpRuntime,
  options: Pick<McpServerOptions, 'connectorFactories' | 'onAddConnector'>,
): void {
  server.tool(
    'add_connector',
    "Add a connector instance to this Rawdash instance. Settings are validated against the connector's configFields schema. For OSS, this is a runtime-only change (not persisted to disk).",
    {
      connector_type: z
        .string()
        .describe(
          'The connector type ID (e.g. "github-actions"). Use list_connectors to see available types.',
        ),
      settings: z
        .record(z.string(), z.unknown())
        .describe(
          'Connector settings as a JSON object. Schema depends on the connector type.',
        ),
    },
    async ({ connector_type, settings }) => {
      const factories = options.connectorFactories ?? [];
      const factory = factories.find((f) => f.id === connector_type);
      if (!factory) {
        const available = factories.map((f) => f.id);
        return err(
          'UNKNOWN_CONNECTOR_TYPE',
          available.length > 0
            ? `Unknown connector type "${connector_type}". Available: ${available.join(', ')}`
            : `Unknown connector type "${connector_type}". No connector factories are registered.`,
        );
      }

      const parsed = factory.configFields.safeParse(settings);
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        return err('INVALID_SETTINGS', `Invalid settings: ${issues}`);
      }

      let entry;
      try {
        entry = { connector: factory.create(parsed.data) };
      } catch (e) {
        return err(
          'CREATE_FAILED',
          `Failed to create connector: ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      try {
        runtime.addConnector(entry);
      } catch (e) {
        return err(
          'ALREADY_EXISTS',
          e instanceof Error ? e.message : String(e),
        );
      }

      try {
        await options.onAddConnector?.(entry);
      } catch (e) {
        return err(
          'ON_ADD_CONNECTOR_FAILED',
          `Connector added in-memory but post-add callback failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      return text({ added: entry.connector.id, idempotent: false });
    },
  );
}
