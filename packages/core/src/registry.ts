import type { z } from 'zod';

import type { ConfiguredConnector } from './config';
import type {
  Connector,
  ConnectorContext,
  CredentialsSchema,
} from './connector';
import type { SecretsResolver } from './secrets';

/**
 * Map of resource name → Zod schema describing the raw API response shape
 * for that resource. Resource names must match the `resource` tag passed to
 * `request()` (see {@link BaseConnector.request}) so the shape-drift pipeline
 * can correlate observations with their declared shape.
 *
 * Consumed by:
 * - the cloud baseline generator, which walks this map at deploy time to
 *   populate `connector_baselines`
 * - property tests in `@rawdash/connector-test-utils`, which fuzz against
 *   each schema
 *
 * See `docs/authoring-a-connector.md` for the authoring guide.
 */
export type ConnectorSchemas = Readonly<Record<string, z.ZodType>>;

/**
 * Compile-time contract every connector class must satisfy. Declaring
 * `static schemas` is mandatory — without it, the connector cannot be added
 * to a {@link ConnectorRegistry} and TypeScript will fail the build.
 */
export type ConnectorClass = {
  new (settings: never, creds?: never, ctx?: ConnectorContext): Connector;
  readonly credentials?: CredentialsSchema;
  readonly schemas: ConnectorSchemas;
};

export type ConnectorRegistry = Record<string, ConnectorClass>;

export function instantiateConnector(
  entry: ConfiguredConnector,
  registry: ConnectorRegistry,
  secretsResolver?: SecretsResolver,
): Connector {
  const Cls = registry[entry.connectorId];
  if (!Cls) {
    throw new Error(
      `Unknown connector type "${entry.connectorId}" for instance "${entry.name}". ` +
        `Add it to the connectorRegistry.`,
    );
  }
  const credSchema = Cls.credentials;
  const settings: Record<string, unknown> = {};
  const creds: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry.config)) {
    if (credSchema && Object.prototype.hasOwnProperty.call(credSchema, key)) {
      creds[key] = value;
    } else {
      settings[key] = value;
    }
  }
  return new Cls(settings as never, (credSchema ? creds : undefined) as never, {
    secretsResolver,
  });
}
