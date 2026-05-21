#!/usr/bin/env -S npx tsx

/**
 * Register `rawdash/rawdash` as a GitHub Actions Trusted Publisher for a
 * scoped npm package, bypassing the buggy `npm trust github` CLI flow.
 *
 * Usage:
 *   tsx scripts/setup-trusted-publisher.ts @rawdash/connector-<name>
 *
 * Why this exists: as of npm CLI 11.14.1, `npm trust github <pkg>` POSTs the
 * correct payload but the registry returns `400 "value must be an array"` —
 * the documented `npm` flow is broken for first-time package trust setup. The
 * registry accepts a direct POST of the same payload shape with a valid
 * bearer token + npm-otp header, so this script issues that POST itself, and
 * handles the web-OTP exchange when the registry returns 401.
 *
 * Requires `~/.npmrc` to contain a valid `//registry.npmjs.org/:_authToken`.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const REGISTRY = 'https://registry.npmjs.org';
const REPOSITORY = 'rawdash/rawdash';
const WORKFLOW_FILE = 'publish.yml';
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

function die(msg: string, code = 1): never {
  process.stderr.write(`✗ ${msg}\n`);
  process.exit(code);
}

function info(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

function readNpmToken(): string {
  const npmrc = join(homedir(), '.npmrc');
  let raw: string;
  try {
    raw = readFileSync(npmrc, 'utf-8');
  } catch {
    die(`Cannot read ${npmrc}. Run \`npm login\` first.`);
  }
  const match = raw.match(/^\/\/registry\.npmjs\.org\/:_authToken=(.+)$/m);
  if (!match) {
    die(
      `No \`//registry.npmjs.org/:_authToken=…\` entry in ${npmrc}. Run \`npm login\` first.`,
    );
  }
  return match[1]!.trim();
}

function escapePkg(name: string): string {
  if (!name.startsWith('@')) {
    die(`Package must be scoped (start with '@'): got ${name}`);
  }
  const [scope, rest] = name.split('/');
  if (!scope || !rest) {
    die(`Package name must be in the form '@scope/name': got ${name}`);
  }
  return `${encodeURIComponent(scope)}%2f${encodeURIComponent(rest)}`;
}

interface AuthChallenge {
  authUrl: string;
  doneUrl: string;
}

interface PostResult {
  status: number;
  body: unknown;
  authChallenge: AuthChallenge | null;
}

async function postTrust(
  pkg: string,
  token: string,
  otp: string | null,
): Promise<PostResult> {
  const url = `${REGISTRY}/-/package/${escapePkg(pkg)}/trust`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent':
      'rawdash setup-trusted-publisher (+https://github.com/rawdash/rawdash)',
  };
  if (otp) {
    headers['npm-otp'] = otp;
  }
  const body = JSON.stringify([
    {
      type: 'github',
      claims: {
        repository: REPOSITORY,
        workflow_ref: { file: WORKFLOW_FILE },
      },
    },
  ]);
  const res = await fetch(url, { method: 'POST', headers, body });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  let authChallenge: AuthChallenge | null = null;
  if (
    parsed &&
    typeof parsed === 'object' &&
    'authUrl' in parsed &&
    'doneUrl' in parsed
  ) {
    const p = parsed as { authUrl: unknown; doneUrl: unknown };
    if (typeof p.authUrl === 'string' && typeof p.doneUrl === 'string') {
      authChallenge = { authUrl: p.authUrl, doneUrl: p.doneUrl };
    }
  }
  return { status: res.status, body: parsed, authChallenge };
}

async function pollForOtp(doneUrl: string, token: string): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const res = await fetch(doneUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });
    if (res.status === 202) {
      continue;
    }
    if (res.ok) {
      const json = (await res.json()) as { token?: unknown };
      if (typeof json.token === 'string' && json.token.length > 0) {
        return json.token;
      }
      die(`done endpoint returned unexpected payload: ${JSON.stringify(json)}`);
    }
    const text = await res.text();
    die(`done endpoint returned ${res.status}: ${text}`);
  }
  die('Timed out waiting for browser-based npm authentication.');
}

function openUrlInBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'start'
        : 'xdg-open';
  const result = spawnSync(cmd, [url], { stdio: 'ignore' });
  if (result.status !== 0) {
    info(`(could not auto-open browser; visit the URL above manually)`);
  }
}

function isAlreadyTrustedError(status: number, body: unknown): boolean {
  if (status !== 409) {
    return false;
  }
  const msg =
    body && typeof body === 'object' && 'message' in body
      ? String((body as { message: unknown }).message)
      : '';
  return /already/i.test(msg) || /exists/i.test(msg);
}

async function main(): Promise<void> {
  const pkg = process.argv[2];
  if (!pkg) {
    die(
      'Usage: tsx scripts/setup-trusted-publisher.ts @rawdash/connector-<name>',
    );
  }
  const token = readNpmToken();
  info(
    `→ Registering ${REPOSITORY} (${WORKFLOW_FILE}) as Trusted Publisher for ${pkg}`,
  );

  let attempt = await postTrust(pkg, token, null);

  if (attempt.status === 401 && attempt.authChallenge) {
    const { authUrl, doneUrl } = attempt.authChallenge;
    info(`→ npm requires web-based authentication. Opening:`);
    info(`    ${authUrl}`);
    openUrlInBrowser(authUrl);
    info('→ Waiting for you to complete the npm auth flow in your browser…');
    const otp = await pollForOtp(doneUrl, token);
    info('→ Got auth token. Retrying trust registration…');
    attempt = await postTrust(pkg, token, otp);
  } else if (attempt.status === 401) {
    die(
      `npm returned 401 without an auth challenge. Body: ${JSON.stringify(attempt.body)}`,
    );
  }

  if (attempt.status >= 200 && attempt.status < 300) {
    info(`✓ Trusted Publisher registered for ${pkg}.`);
    return;
  }

  if (isAlreadyTrustedError(attempt.status, attempt.body)) {
    info(`✓ ${pkg} already has a Trusted Publisher entry; nothing to do.`);
    return;
  }

  die(
    `npm registry rejected the trust request: HTTP ${attempt.status} ${JSON.stringify(attempt.body)}`,
  );
}

main().catch((err) => {
  die(err instanceof Error ? (err.stack ?? err.message) : String(err));
});
