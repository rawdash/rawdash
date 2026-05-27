import { spinner } from '@clack/prompts';
import { Command } from 'commander';
import { readFile } from 'node:fs/promises';

import {
  ApiError,
  listSecrets,
  removeSecret,
  setSecret,
} from '../lib/api-client';
import { requireApiKey } from '../lib/env';
import { printError, printSuccess } from '../lib/output';

export const secretsCommand = new Command('secrets').description(
  'Manage secrets',
);

interface SetOptions {
  json?: string;
  fromFile?: string;
}

secretsCommand
  .command('set <name> [value]')
  .description(
    'Set a secret. Pass value as argument, via stdin, or as structured JSON via --json / --from-file.',
  )
  .option(
    '--json <json>',
    'Set the secret to a JSON-encoded value (object, array, etc.). Validated before sending.',
  )
  .option(
    '--from-file <path>',
    'Read the secret value as JSON from a file. Validated before sending.',
  )
  .action(async (name: string, value: string | undefined, opts: SetOptions) => {
    requireApiKey();

    const usingJson = opts.json !== undefined;
    const usingFile = opts.fromFile !== undefined;

    if (usingJson && usingFile) {
      printError('Cannot use --json and --from-file together.');
      process.exit(1);
    }
    if ((usingJson || usingFile) && value !== undefined) {
      printError(
        'Cannot combine a positional value with --json or --from-file.',
      );
      process.exit(1);
    }

    let secretValue: string;
    if (usingJson) {
      const raw = opts.json!;
      try {
        JSON.parse(raw);
      } catch (err) {
        printError(
          `Invalid JSON passed to --json: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
      secretValue = raw;
    } else if (usingFile) {
      let raw: string;
      try {
        raw = await readFile(opts.fromFile!, 'utf8');
      } catch (err) {
        printError(
          `Failed to read file "${opts.fromFile}": ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
      try {
        JSON.parse(raw);
      } catch (err) {
        printError(
          `File "${opts.fromFile}" does not contain valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
      secretValue = raw;
    } else if (value !== undefined) {
      secretValue = value;
    } else {
      const stdin = await readStdin();
      if (!stdin) {
        printError('No value provided. Pass as argument or via stdin.');
        process.exit(1);
      }
      secretValue = stdin;
    }

    const s = spinner();
    s.start(`Setting secret ${name}...`);
    try {
      await setSecret(name, secretValue);
      s.stop('');
      printSuccess(`Secret ${name} set`);
    } catch (err) {
      s.stop('');
      printError(err instanceof Error ? err.message : String(err));
      process.exit(authExitCode(err));
    }
  });

secretsCommand
  .command('list')
  .description('List all secrets (names and last-rotated timestamps)')
  .action(async () => {
    requireApiKey();

    const s = spinner();
    s.start('Fetching secrets...');
    try {
      const secrets = await listSecrets();
      s.stop('');
      if (secrets.length === 0) {
        console.log('No secrets configured.');
        return;
      }
      for (const { name, lastRotatedAt } of secrets) {
        const ts = lastRotatedAt
          ? new Date(lastRotatedAt).toLocaleString()
          : 'never';
        console.log(`  ${name}  (last rotated: ${ts})`);
      }
    } catch (err) {
      s.stop('');
      printError(err instanceof Error ? err.message : String(err));
      process.exit(authExitCode(err));
    }
  });

secretsCommand
  .command('remove <name>')
  .description('Remove a secret')
  .action(async (name: string) => {
    requireApiKey();

    const s = spinner();
    s.start(`Removing secret ${name}...`);
    try {
      await removeSecret(name);
      s.stop('');
      printSuccess(`Secret ${name} removed`);
    } catch (err) {
      s.stop('');
      printError(err instanceof Error ? err.message : String(err));
      process.exit(authExitCode(err));
    }
  });

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', () =>
      resolve(Buffer.concat(chunks).toString('utf8')),
    );
    process.stdin.on('error', reject);
  });
}

function authExitCode(err: unknown): number {
  if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
    return 3;
  }
  return 1;
}
