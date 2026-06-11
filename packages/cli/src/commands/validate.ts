import { Command } from 'commander';

import { findConfigFile, loadConfig } from '../lib/config-loader';
import { validateMetricsOrThrow } from '../lib/metric-validation';
import { printError, printSuccess } from '../lib/output';

export const validateCommand = new Command('validate')
  .description('Validate rawdash.config.ts locally without network access')
  .option('--config <path>', 'path to rawdash.config.ts')
  .action(async (opts: { config?: string }) => {
    const configPath = await findConfigFile(opts.config).catch(
      (err: unknown) => {
        printError(err instanceof Error ? err.message : String(err));
        process.exit(2);
      },
    );

    try {
      const config = await loadConfig(configPath);
      await validateMetricsOrThrow(config);
      console.log(JSON.stringify(config, null, 2));
      printSuccess('Config is valid');
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(2);
    }
  });
