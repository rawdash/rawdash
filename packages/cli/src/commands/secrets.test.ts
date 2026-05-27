import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { secretsCommand } from './secrets';

const setSecretMock = vi.fn<(name: string, value: string) => Promise<void>>();

vi.mock('../lib/api-client', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/api-client')>(
      '../lib/api-client',
    );
  return {
    ...actual,
    setSecret: (name: string, value: string) => setSecretMock(name, value),
    listSecrets: vi.fn(),
    removeSecret: vi.fn(),
  };
});

class ProcessExit extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const runSet = async (...args: string[]): Promise<void> => {
  secretsCommand.exitOverride((err) => {
    throw new ProcessExit(err.exitCode ?? 1);
  });
  await secretsCommand.parseAsync(['set', ...args], { from: 'user' });
};

describe('secrets set', () => {
  let tmpDir: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    process.env['RAWDASH_URL'] = 'https://api.example.test';
    process.env['RAWDASH_API_KEY'] = 'test-key';
    setSecretMock.mockReset();
    setSecretMock.mockResolvedValue();
    tmpDir = await mkdtemp(path.join(tmpdir(), 'rawdash-secrets-'));
    exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((code?: number | string | null) => {
        throw new ProcessExit(typeof code === 'number' ? code : 1);
      });
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    delete process.env['RAWDASH_URL'];
    delete process.env['RAWDASH_API_KEY'];
    exitSpy.mockRestore();
    errorSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('POSTs the raw JSON string for a valid --json value', async () => {
    await runSet('MY_SECRET', '--json', '{"a":1,"b":"two"}');
    expect(setSecretMock).toHaveBeenCalledWith(
      'MY_SECRET',
      '{"a":1,"b":"two"}',
    );
  });

  it('errors before any network call on invalid --json', async () => {
    await expect(
      runSet('MY_SECRET', '--json', '{not json'),
    ).rejects.toBeInstanceOf(ProcessExit);
    expect(setSecretMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    const message = errorSpy.mock.calls
      .map((c: unknown[]) => c.join(' '))
      .join('\n');
    expect(message).toMatch(/Invalid JSON/);
  });

  it('reads + validates + POSTs the contents of --from-file', async () => {
    const filePath = path.join(tmpDir, 'creds.json');
    const payload = '{"type":"role","roleArn":"arn:aws:iam::1:role/x"}';
    await writeFile(filePath, payload, 'utf8');

    await runSet('MY_SECRET', '--from-file', filePath);
    expect(setSecretMock).toHaveBeenCalledWith('MY_SECRET', payload);
  });

  it('errors when --from-file points to a file with invalid JSON', async () => {
    const filePath = path.join(tmpDir, 'bad.json');
    await writeFile(filePath, 'not json at all', 'utf8');

    await expect(
      runSet('MY_SECRET', '--from-file', filePath),
    ).rejects.toBeInstanceOf(ProcessExit);
    expect(setSecretMock).not.toHaveBeenCalled();
  });

  it('rejects --json combined with a positional value', async () => {
    await expect(
      runSet('MY_SECRET', 'positional', '--json', '"x"'),
    ).rejects.toBeInstanceOf(ProcessExit);
    expect(setSecretMock).not.toHaveBeenCalled();
    const message = errorSpy.mock.calls
      .map((c: unknown[]) => c.join(' '))
      .join('\n');
    expect(message).toMatch(/Cannot combine/);
  });

  it('rejects --json combined with --from-file', async () => {
    const filePath = path.join(tmpDir, 'creds.json');
    await writeFile(filePath, '{}', 'utf8');
    await expect(
      runSet('MY_SECRET', '--json', '{}', '--from-file', filePath),
    ).rejects.toBeInstanceOf(ProcessExit);
    expect(setSecretMock).not.toHaveBeenCalled();
  });

  it('passes a positional string value through unchanged', async () => {
    await runSet('MY_SECRET', 'ghp_abc123');
    expect(setSecretMock).toHaveBeenCalledWith('MY_SECRET', 'ghp_abc123');
  });
});
