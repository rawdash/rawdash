import {
  BaseConnector,
  type ConnectorContext,
  type ConnectorDoc,
  type Entity,
  type Event,
  type JSONValue,
  type StorageHandle,
  type SyncOptions,
  type SyncResult,
  defineConfigFields,
  defineConnectorDoc,
  defineResources,
  schemasFromResources,
} from '@rawdash/core';
import { z } from 'zod';

import { defaultTlsProbe } from './tls-probe';

export const id = 'ssl-monitor';

const DEFAULT_PORT = 443;
const DEFAULT_SEVERITY_THRESHOLD_DAYS = 30;
const DEFAULT_PROBE_TIMEOUT_MS = 10_000;
const MAX_PORT = 65_535;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const domainSchema = z.object({
  host: z
    .string()
    .trim()
    .min(1)
    .regex(
      /^[A-Za-z0-9.-]+$/,
      'Host must be a bare hostname (no scheme, path, or port).',
    )
    .meta({
      label: 'Host',
      description:
        'Hostname to check, without scheme or port (e.g. example.com).',
      placeholder: 'example.com',
    }),
  port: z.number().int().min(1).max(MAX_PORT).optional().meta({
    label: 'Port',
    description: 'TLS port to connect to. Defaults to 443.',
    placeholder: '443',
  }),
  severityThresholdDays: z.number().int().positive().max(3650).optional().meta({
    label: 'Expiry warning threshold (days)',
    description:
      'Certificates expiring within this many days are reported as expiring_soon. Defaults to 30.',
    placeholder: '30',
  }),
});

export const configFields = defineConfigFields(
  z.object({
    domains: z.array(domainSchema).nonempty().meta({
      label: 'Domains',
      description:
        'The hostnames whose TLS certificates to monitor. Each entry is checked once per sync.',
    }),
    resources: z
      .array(z.enum(['certificates', 'checks']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which resources to write. Omit to write both the current certificate entities and the per-check event stream.',
      }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'SSL Certificate Monitor',
  category: 'security',
  brandColor: '#2E7D32',
  tagline:
    'Monitor TLS certificate expiry and health across your domains - one widget that catches an expired certificate before it takes a site down.',
  vendor: {
    name: 'SSL Certificate Monitor',
    domain: 'rawdash.dev',
    website: 'https://rawdash.dev',
  },
  auth: {
    summary:
      'No credentials are required. The connector is self-contained: it opens a TLS connection to each configured host and reads the certificate the server presents, exactly as a browser would. Only outbound network access to the monitored hosts on their TLS port is needed.',
    setup: [
      'List the hostnames you want to monitor under `domains` (for example example.com).',
      'Optionally set a per-domain `port` (defaults to 443) and `severityThresholdDays` (defaults to 30).',
      'No secret is required - certificate metadata is public and read during the TLS handshake.',
    ],
  },
  rateLimit:
    'There is no upstream API and no rate limit. Each sync opens one short-lived TLS connection per domain. Control cadence with the connector sync interval; hourly is plenty for expiry monitoring.',
  limitations: [
    'Certificates are read from a live TLS handshake, so there is no historical backfill - the check event stream begins at the first sync and builds up over time.',
    'A host that cannot be reached is recorded as an unreachable check without a certificate entity; the last known certificate entity from a prior successful sync is retained.',
    'The signature algorithm is not exposed by the TLS peer-certificate API and is therefore not reported.',
    'Only the leaf (server) certificate is inspected; intermediate and root chain certificates are not synced.',
  ],
});

const tlsCertificateSchema = z.object({
  subjectCN: z.string().nullable(),
  issuer: z.string().nullable(),
  validFrom: z.string().nullable(),
  validTo: z.string().nullable(),
  fingerprint: z.string().nullable(),
  serialNumber: z.string().nullable(),
  subjectAltNames: z.array(z.string()),
});

export type TlsCertificate = z.infer<typeof tlsCertificateSchema>;

const certProbeOutcomeSchema = z.union([
  z.object({
    ok: z.literal(true),
    certificate: tlsCertificateSchema,
    authorizationError: z.string().nullable(),
  }),
  z.object({
    ok: z.literal(false),
    reason: z.literal('unreachable'),
    message: z.string(),
  }),
]);

export type CertProbeOutcome = z.infer<typeof certProbeOutcomeSchema>;

export type CertProbe = (
  target: { host: string; port: number; timeoutMs: number },
  signal?: AbortSignal,
) => Promise<CertProbeOutcome>;

export type CheckStatus =
  | 'ok'
  | 'expiring_soon'
  | 'expired'
  | 'invalid'
  | 'unreachable';

export const sslMonitorResources = defineResources({
  ssl_certificate: {
    shape: 'entity',
    filterable: [],
    description:
      'The TLS certificate a host currently presents, one entity per host:port, with issuer, validity window, days until expiry, and a derived health status.',
    endpoint: 'TLS handshake to {host}:{port}',
    notes:
      'Read live from the server on each sync via a TLS handshake; there is no upstream API. Unreachable hosts keep their last known certificate entity.',
    fields: [
      { name: 'host', description: 'Monitored hostname.' },
      { name: 'port', description: 'TLS port that was probed.' },
      {
        name: 'status',
        description:
          'Derived certificate health: ok | expiring_soon | expired | invalid.',
      },
      {
        name: 'subjectCN',
        description: 'Certificate subject common name, or null if absent.',
      },
      {
        name: 'issuer',
        description: 'Issuing authority common name or organization.',
      },
      {
        name: 'validFrom',
        description: 'Start of the validity window (epoch ms), or null.',
      },
      {
        name: 'validTo',
        description: 'End of the validity window (epoch ms), or null.',
      },
      {
        name: 'daysUntilExpiry',
        description:
          'Whole days from the sync time until validTo (negative once expired), or null when the validity window is unparseable.',
      },
      {
        name: 'fingerprint',
        description: 'SHA-256 fingerprint of the certificate.',
      },
      {
        name: 'serialNumber',
        description: 'Certificate serial number.',
      },
      {
        name: 'subjectAltNames',
        description: 'Subject alternative names presented by the certificate.',
      },
    ],
    responses: { ssl_probe: certProbeOutcomeSchema },
  },
  ssl_check: {
    shape: 'event',
    filterable: [],
    description:
      'One event per host per sync recording the outcome of the TLS check, including unreachable and invalid results that never produce a certificate entity.',
    endpoint: 'TLS handshake to {host}:{port}',
    notes:
      'Emitted at the sync time. This is the time series behind uptime-style widgets and status transitions.',
    fields: [
      { name: 'host', description: 'Monitored hostname.' },
      { name: 'port', description: 'TLS port that was probed.' },
      {
        name: 'status',
        description:
          'Check outcome: ok | expiring_soon | expired | invalid | unreachable.',
      },
      {
        name: 'daysUntilExpiry',
        description:
          'Whole days until expiry at check time, or null when unknown.',
      },
      {
        name: 'message',
        description:
          'Human-readable detail for unreachable or invalid checks, or null when the check succeeded.',
      },
    ],
  },
});

export type SslMonitorResource = 'certificates' | 'checks';

export interface SslMonitorDomain {
  host: string;
  port?: number;
  severityThresholdDays?: number;
}

export interface SslMonitorSettings {
  domains: readonly SslMonitorDomain[];
  resources?: readonly SslMonitorResource[];
}

function parseCertTimestamp(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

interface EvaluatedCheck {
  status: CheckStatus;
  certificate: TlsCertificate | null;
  authorizationError: string | null;
  validFromMs: number | null;
  validToMs: number | null;
  daysUntilExpiry: number | null;
  message: string | null;
}

export function evaluateProbeOutcome(
  outcome: CertProbeOutcome,
  thresholdDays: number,
  now: number,
): EvaluatedCheck {
  if (!outcome.ok) {
    return {
      status: 'unreachable',
      certificate: null,
      authorizationError: null,
      validFromMs: null,
      validToMs: null,
      daysUntilExpiry: null,
      message: outcome.message,
    };
  }

  const cert = outcome.certificate;
  const validFromMs = parseCertTimestamp(cert.validFrom);
  const validToMs = parseCertTimestamp(cert.validTo);
  const daysUntilExpiry =
    validToMs === null ? null : Math.floor((validToMs - now) / MS_PER_DAY);

  let status: CheckStatus;
  let message: string | null = null;
  if (validToMs === null || validFromMs === null) {
    status = 'invalid';
    message = 'certificate validity window could not be parsed';
  } else if (now > validToMs) {
    status = 'expired';
    message = 'certificate has expired';
  } else if (now < validFromMs) {
    status = 'invalid';
    message = 'certificate is not yet valid';
  } else if (daysUntilExpiry !== null && daysUntilExpiry <= thresholdDays) {
    status = 'expiring_soon';
  } else if (outcome.authorizationError !== null) {
    status = 'invalid';
    message = outcome.authorizationError;
  } else {
    status = 'ok';
  }

  return {
    status,
    certificate: cert,
    authorizationError: outcome.authorizationError,
    validFromMs,
    validToMs,
    daysUntilExpiry,
    message,
  };
}

export class SslMonitorConnector extends BaseConnector<
  SslMonitorSettings,
  Record<string, never>
> {
  static readonly id = id;

  static readonly resources = sslMonitorResources;

  static readonly schemas = schemasFromResources(sslMonitorResources);

  static create(
    input: unknown,
    ctx?: ConnectorContext,
    probe?: CertProbe,
  ): SslMonitorConnector {
    const parsed = configFields.parse(input);
    return new SslMonitorConnector(
      { domains: parsed.domains, resources: parsed.resources },
      undefined,
      ctx,
      probe,
    );
  }

  readonly id = id;

  private readonly probe: CertProbe;

  private readonly timeoutMs = DEFAULT_PROBE_TIMEOUT_MS;

  constructor(
    settings: SslMonitorSettings,
    _creds?: undefined,
    ctx?: ConnectorContext,
    probe: CertProbe = defaultTlsProbe,
  ) {
    super(settings, undefined, ctx);
    this.probe = probe;
  }

  private buildCertificateEntity(
    host: string,
    port: number,
    evaluated: EvaluatedCheck,
    now: number,
  ): Entity {
    const cert = evaluated.certificate as TlsCertificate;
    const attributes: Record<string, JSONValue> = {
      host,
      port,
      url: `${host}:${port}`,
      status: evaluated.status,
      subjectCN: cert.subjectCN,
      issuer: cert.issuer,
      validFrom: evaluated.validFromMs,
      validTo: evaluated.validToMs,
      daysUntilExpiry: evaluated.daysUntilExpiry,
      fingerprint: cert.fingerprint,
      serialNumber: cert.serialNumber,
      subjectAltNames: cert.subjectAltNames,
      authorizationError: evaluated.authorizationError,
      lastCheckedAt: now,
    };
    return {
      type: 'ssl_certificate',
      id: `${host}:${port}`,
      attributes,
      updated_at: now,
    };
  }

  private buildCheckEvent(
    host: string,
    port: number,
    evaluated: EvaluatedCheck,
    now: number,
  ): Event {
    return {
      name: 'ssl_check',
      start_ts: now,
      end_ts: null,
      attributes: {
        host,
        port,
        url: `${host}:${port}`,
        status: evaluated.status,
        daysUntilExpiry: evaluated.daysUntilExpiry,
        message: evaluated.message,
      },
    };
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const now = Date.now();
    const writeCertificates = this.isResourceEnabled('certificates');
    const writeChecks = this.isResourceEnabled('checks');

    const certificates: Entity[] = [];
    const checks: Event[] = [];

    for (const domain of this.settings.domains) {
      signal?.throwIfAborted();
      const host = domain.host;
      const port = domain.port ?? DEFAULT_PORT;
      const thresholdDays =
        domain.severityThresholdDays ?? DEFAULT_SEVERITY_THRESHOLD_DAYS;

      let outcome: CertProbeOutcome;
      try {
        outcome = await this.probe(
          { host, port, timeoutMs: this.timeoutMs },
          signal,
        );
      } catch (err) {
        this.logger.warn('probe failed', {
          resource: 'checks',
          host,
          port,
          error: err instanceof Error ? err.message : String(err),
        });
        outcome = {
          ok: false,
          reason: 'unreachable',
          message: err instanceof Error ? err.message : String(err),
        };
      }

      const evaluated = evaluateProbeOutcome(outcome, thresholdDays, now);
      if (evaluated.certificate) {
        certificates.push(
          this.buildCertificateEntity(host, port, evaluated, now),
        );
      }
      checks.push(this.buildCheckEvent(host, port, evaluated, now));
      this.logger.info('checked domain', {
        resource: 'checks',
        host,
        port,
        status: evaluated.status,
        daysUntilExpiry: evaluated.daysUntilExpiry,
      });
    }

    if (writeCertificates) {
      if (options.mode === 'full') {
        await storage.entities(certificates, { types: ['ssl_certificate'] });
      } else {
        for (const entity of certificates) {
          await storage.entity(entity);
        }
      }
    }

    if (writeChecks) {
      for (const event of checks) {
        await storage.event(event);
      }
    }

    this.logger.info('resource done', {
      resource: 'ssl-monitor',
      domains: this.settings.domains.length,
      certificatesWritten: writeCertificates ? certificates.length : 0,
      checksWritten: writeChecks ? checks.length : 0,
    });

    return { done: true };
  }
}
