import pc from 'picocolors';

import type {
  CloudConnectorEntry,
  CloudDashboardEntry,
  ConfigDiff,
  DiffSet,
} from './api-client';

export function printDiff(diff: ConfigDiff): void {
  printDiffSection('Connectors', diff.connectors, (c) => c.name);
  printDiffSection('Dashboards', diff.dashboards, (d) => d.slug);
}

function printDiffSection<T extends CloudConnectorEntry | CloudDashboardEntry>(
  label: string,
  diff: DiffSet<T>,
  getName: (t: T) => string,
): void {
  if (
    diff.added.length === 0 &&
    diff.modified.length === 0 &&
    diff.removed.length === 0
  ) {
    console.log(pc.dim(`  ${label}: no changes`));
    return;
  }
  console.log(pc.bold(`  ${label}:`));
  for (const item of diff.added) {
    console.log(pc.green(`    + ${getName(item)}`));
  }
  for (const item of diff.modified) {
    console.log(pc.yellow(`    ~ ${getName(item)}`));
  }
  for (const item of diff.removed) {
    console.log(pc.red(`    - ${getName(item)}`));
  }
}

export function printError(message: string): void {
  console.error(pc.red(`✗ ${message}`));
}

export function printSuccess(message: string): void {
  console.log(pc.green(`✓ ${message}`));
}
