#!/usr/bin/env -S npx tsx
import matter from 'gray-matter';
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const CHANGESET_DIR = join(REPO_ROOT, '.changeset');

type WorkspacePackage = {
  name?: string;
  private?: boolean;
};

type ChangesetReference = {
  file: string;
  packageName: string;
};

function listWorkspacePackages(): WorkspacePackage[] {
  const raw = execSync('pnpm ls -r --depth -1 --json', {
    cwd: REPO_ROOT,
    stdio: ['pipe', 'pipe', 'inherit'],
  }).toString();
  return JSON.parse(raw) as WorkspacePackage[];
}

function parseFrontmatterPackages(contents: string): string[] {
  const { data } = matter(contents);
  return Object.keys(data);
}

function collectChangesetReferences(): ChangesetReference[] {
  const references: ChangesetReference[] = [];
  for (const file of readdirSync(CHANGESET_DIR)) {
    if (!file.endsWith('.md') || file === 'README.md') {
      continue;
    }
    const contents = readFileSync(join(CHANGESET_DIR, file), 'utf8');
    for (const packageName of parseFrontmatterPackages(contents)) {
      references.push({ file, packageName });
    }
  }
  return references;
}

function main(): void {
  const packages = listWorkspacePackages();
  const privateNames = new Set(
    packages.filter((p) => p.name && p.private).map((p) => p.name!),
  );
  const knownNames = new Set(packages.map((p) => p.name).filter(Boolean));

  const errors: string[] = [];
  for (const { file, packageName } of collectChangesetReferences()) {
    if (privateNames.has(packageName)) {
      errors.push(
        `.changeset/${file} references ${packageName}, which is a private ` +
          `package. With "privatePackages": { "version": false } in ` +
          `.changeset/config.json, changesets never versions it — a changeset ` +
          `that targets only private packages produces an empty release PR ` +
          `and breaks the publish train ("No commits between main and ` +
          `changeset-release/main"). Remove this changeset; changes to ` +
          `private packages ship transitively through their public consumers.`,
      );
    } else if (!knownNames.has(packageName)) {
      errors.push(
        `.changeset/${file} references ${packageName}, which is not a ` +
          `workspace package. Fix the package name in the changeset frontmatter.`,
      );
    }
  }

  for (const e of errors) {
    console.error(`\n❌ ${e}`);
  }

  if (errors.length > 0) {
    console.error(`\n${errors.length} changeset validation check(s) failed.`);
    process.exit(1);
  }

  console.log('✓ No changesets target private or unknown packages.');
}

main();
