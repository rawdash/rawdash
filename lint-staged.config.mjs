import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';

function findPackageRoot(filePath) {
  let dir = dirname(filePath);
  while (dir !== dirname(dir)) {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      if (pkg.name && pkg.name !== 'rawdash') {
        return pkg.name;
      }
    }
    dir = dirname(dir);
  }
  return null;
}

function buildTypecheckCommand(stagedFiles) {
  const packageNames = [
    ...new Set(stagedFiles.map(findPackageRoot).filter(Boolean)),
  ];
  if (packageNames.length === 0) {
    return "echo 'No affected packages to typecheck'";
  }
  const filters = packageNames.map((name) => `--filter=${name}`).join(' ');
  return `pnpm turbo run typecheck ${filters}`;
}

export default {
  '**/*.{ts,tsx}': ['prettier --write', 'eslint --fix', buildTypecheckCommand],
  '**/*.{js,mjs,cjs,json,md,yml,yaml}': ['prettier --write'],
};
