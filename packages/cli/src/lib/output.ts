import pc from 'picocolors';

export interface Diff {
  added: string[];
  removed: string[];
  modified: string[];
}

export function printDiff(diff: Diff): void {
  if (
    diff.added.length === 0 &&
    diff.removed.length === 0 &&
    diff.modified.length === 0
  ) {
    console.log('  (no changes)');
    return;
  }
  for (const item of diff.added) {
    console.log(pc.green(`  + ${item}`));
  }
  for (const item of diff.modified) {
    console.log(pc.yellow(`  ~ ${item}`));
  }
  for (const item of diff.removed) {
    console.log(pc.red(`  - ${item}`));
  }
}

export function printError(message: string): void {
  console.error(pc.red(`✗ ${message}`));
}

export function printSuccess(message: string): void {
  console.log(pc.green(`✓ ${message}`));
}
