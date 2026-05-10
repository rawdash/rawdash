import { spinner } from '@clack/prompts';
import { Command } from 'commander';
import { createInterface } from 'node:readline';

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

secretsCommand
  .command('set <name> [value]')
  .description('Set a secret (reads value from stdin if not provided)')
  .action(async (name: string, value?: string) => {
    requireApiKey();

    let secretValue = value;
    if (!secretValue) {
      secretValue = await readStdin();
      if (!secretValue) {
        printError('No value provided. Pass as argument or via stdin.');
        process.exit(1);
      }
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
  return new Promise((resolve) => {
    let data = '';
    const rl = createInterface({ input: process.stdin });
    rl.on('line', (line) => {
      data += line;
    });
    rl.on('close', () => resolve(data.trim()));
  });
}

function authExitCode(err: unknown): number {
  if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
    return 3;
  }
  return 1;
}
