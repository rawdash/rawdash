import { Command } from 'commander';

import { deployCommand } from './commands/deploy';
import { secretsCommand } from './commands/secrets';
import { validateCommand } from './commands/validate';

const program = new Command();

program
  .name('rawdash')
  .description('Rawdash CLI — deploy and manage your dashboard config')
  .version('0.0.0');

program.addCommand(deployCommand);
program.addCommand(secretsCommand);
program.addCommand(validateCommand);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
