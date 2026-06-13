import { confirm, isCancel, spinner } from '@clack/prompts';
import { Command } from 'commander';

import { postConfig, validateConfigRemote } from '../lib/api-client';
import { findConfigFile, loadConfig } from '../lib/config-loader';
import { requireApiKey } from '../lib/env';
import {
  printDiff,
  printError,
  printSuccess,
  printWarning,
} from '../lib/output';

export const deployCommand = new Command('deploy')
  .description('Deploy rawdash.config.ts to the server')
  .option('--config <path>', 'path to rawdash.config.ts')
  .option('--dry-run', 'validate and diff without persisting')
  .option('--yes', 'skip confirmation prompt (useful in CI)')
  .action(
    async (opts: { config?: string; dryRun?: boolean; yes?: boolean }) => {
      requireApiKey();

      const configPath = await findConfigFile(opts.config).catch(
        (err: unknown) => {
          printError(err instanceof Error ? err.message : String(err));
          process.exit(2);
        },
      );

      const s = spinner();
      s.start('Loading config...');

      const config = await loadConfig(configPath).catch((err: unknown) => {
        s.stop('Failed to load config');
        printError(err instanceof Error ? err.message : String(err));
        process.exit(2);
      });
      s.stop('Config loaded');

      s.start('Validating metrics...');
      const validation = await validateConfigRemote(config);
      if (validation.skipped) {
        s.stop('Metric validation skipped (server does not support it)');
      } else if (validation.errors.length > 0) {
        s.stop('Metric validation failed');
        for (const warning of validation.warnings) {
          printWarning(`${warning.ref}: ${warning.message}`);
        }
        for (const error of validation.errors) {
          printError(`${error.ref}: ${error.message}`);
        }
        process.exit(2);
      } else {
        s.stop('Metrics valid');
        for (const warning of validation.warnings) {
          printWarning(`${warning.ref}: ${warning.message}`);
        }
      }

      s.start('Fetching diff...');
      const previewResult = await postConfig(config, true);
      s.stop('');

      if (!previewResult.ok) {
        printError(previewResult.error);
        process.exit(exitCodeForStatus(previewResult.status));
      }

      printDiff(previewResult.diff);

      if (opts.dryRun) {
        printSuccess('Dry run complete — no changes applied');
        return;
      }

      if (!opts.yes) {
        const confirmed = await confirm({ message: 'Apply this diff?' });
        if (isCancel(confirmed) || !confirmed) {
          console.log('Aborted.');
          process.exit(0);
        }
      }

      s.start('Deploying...');
      const deployResult = await postConfig(config, false);
      s.stop('');

      if (!deployResult.ok) {
        printError(deployResult.error);
        process.exit(exitCodeForStatus(deployResult.status));
      }

      printSuccess('Deployed');
    },
  );

function exitCodeForStatus(status: number): number {
  if (status === 401 || status === 403) {
    return 3;
  }
  if (status === 409) {
    return 4;
  }
  if (status === 422) {
    return 2;
  }
  return 1;
}
