import type {
  CertProbe,
  CertProbeOutcome,
  TlsCertificate,
} from './ssl-monitor';

interface PeerCertificateLike {
  subject?: { CN?: string };
  issuer?: { CN?: string; O?: string };
  valid_from?: string;
  valid_to?: string;
  fingerprint?: string;
  fingerprint256?: string;
  serialNumber?: string;
  subjectaltname?: string;
}

interface TlsSocketLike {
  authorized: boolean;
  authorizationError?: Error | string | null;
  getPeerCertificate(): PeerCertificateLike;
  end(): void;
  destroy(): void;
  setTimeout(ms: number): void;
  once(event: string, listener: (arg?: unknown) => void): void;
}

interface TlsModuleLike {
  connect(
    options: {
      host: string;
      port: number;
      servername: string;
      rejectUnauthorized: boolean;
    },
    onSecureConnect: () => void,
  ): TlsSocketLike;
}

function splitSubjectAltName(value: string | undefined): string[] {
  if (typeof value !== 'string' || value.length === 0) {
    return [];
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function mapPeerCertificate(cert: PeerCertificateLike): TlsCertificate {
  return {
    subjectCN: cert.subject?.CN ?? null,
    issuer: cert.issuer?.CN ?? cert.issuer?.O ?? null,
    validFrom: cert.valid_from ?? null,
    validTo: cert.valid_to ?? null,
    fingerprint: cert.fingerprint256 ?? cert.fingerprint ?? null,
    serialNumber: cert.serialNumber ?? null,
    subjectAltNames: splitSubjectAltName(cert.subjectaltname),
  };
}

// Loaded through a non-literal specifier so the node:tls dependency never
// enters this package's static type graph: that keeps the connector metadata
// (imported by @rawdash/connectors) typecheckable without node types and lets
// the module load on non-Node runtimes - only running the default probe needs
// a real TLS stack.
const TLS_MODULE_ID: string = 'node:tls';

function probe(
  tls: TlsModuleLike,
  { host, port, timeoutMs }: { host: string; port: number; timeoutMs: number },
  signal: AbortSignal | undefined,
): Promise<CertProbeOutcome> {
  return new Promise<CertProbeOutcome>((resolve) => {
    let settled = false;
    let socket: TlsSocketLike | undefined;

    const onAbort = (): void => {
      socket?.destroy();
      settle({ ok: false, reason: 'unreachable', message: 'aborted' });
    };
    const settle = (outcome: CertProbeOutcome): void => {
      if (settled) {
        return;
      }
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      resolve(outcome);
    };

    try {
      socket = tls.connect(
        { host, port, servername: host, rejectUnauthorized: false },
        () => {
          const active = socket as TlsSocketLike;
          const cert = active.getPeerCertificate();
          const authorizationError = active.authorized
            ? null
            : String(active.authorizationError ?? 'unauthorized');
          active.end();
          if (!cert || Object.keys(cert).length === 0) {
            settle({
              ok: false,
              reason: 'unreachable',
              message: 'server presented no certificate',
            });
            return;
          }
          settle({
            ok: true,
            certificate: mapPeerCertificate(cert),
            authorizationError,
          });
        },
      );
    } catch (err) {
      settle({
        ok: false,
        reason: 'unreachable',
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    socket.setTimeout(timeoutMs);
    socket.once('timeout', () => {
      socket?.destroy();
      settle({
        ok: false,
        reason: 'unreachable',
        message: `TLS handshake timed out after ${timeoutMs}ms`,
      });
    });
    socket.once('error', (err) => {
      settle({
        ok: false,
        reason: 'unreachable',
        message: err instanceof Error ? err.message : String(err),
      });
    });

    if (signal) {
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }
  });
}

export const defaultTlsProbe: CertProbe = async (target, signal) => {
  const tls = (await import(TLS_MODULE_ID)) as unknown as TlsModuleLike;
  return probe(tls, target, signal);
};
