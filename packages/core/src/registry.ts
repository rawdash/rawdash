import type { ConnectorLogger } from '@rawdash/connector-shared';
import type { z } from 'zod';

import type { ConfiguredConnector } from './config';
import type {
  Connector,
  ConnectorContext,
  CredentialsSchema,
} from './connector';
import type { ResourceDefinitions } from './resource';
import type { SecretsResolver } from './secrets';

export interface ConnectorCost {
  recommendedInterval?: string;
  minInterval?: string;
  perSync?: string;
  warning?: string;
}

export type ConnectorSchemas = Readonly<Record<string, z.ZodType>>;

export type ConnectorClass = {
  new (settings: never, creds?: never, ctx?: ConnectorContext): Connector;
  readonly credentials?: CredentialsSchema;
  readonly schemas: ConnectorSchemas;
  readonly resources?: ResourceDefinitions;
  readonly cost?: ConnectorCost;
};

export type ConnectorRegistry = Record<string, ConnectorClass>;

export function instantiateConnector(
  entry: ConfiguredConnector,
  registry: ConnectorRegistry,
  secretsResolver?: SecretsResolver,
  logger?: ConnectorLogger,
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
    logger,
  });
}
