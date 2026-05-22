import type { ConfiguredConnector } from './config';
import type {
  Connector,
  ConnectorContext,
  CredentialsSchema,
} from './connector';
import type { SecretsResolver } from './secrets';

export type ConnectorClass = {
  new (settings: never, creds?: never, ctx?: ConnectorContext): Connector;
  readonly credentials?: CredentialsSchema;
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
