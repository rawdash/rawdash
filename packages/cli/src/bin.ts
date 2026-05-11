import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { deployCommand } from './commands/deploy';
import { secretsCommand } from './commands/secrets';
import { validateCommand } from './commands/validate';

const pkg = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../package.json'),
    'utf8',
  ),
) as { version: string };

const program = new Command();

program
  .name('rawdash')
  .description('Rawdash CLI — deploy and manage your dashboard config')
  .version(pkg.version);

program.addCommand(deployCommand);
program.addCommand(secretsCommand);
program.addCommand(validateCommand);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
