import { type DashboardConfig, defineConfig } from '@rawdash/core';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tsImport } from 'tsx/esm/api';

export async function findConfigFile(explicitPath?: string): Promise<string> {
  if (explicitPath) {
    const abs = resolve(explicitPath);
    if (!existsSync(abs)) {
      throw new Error(`Config file not found: ${abs}`);
    }
    return abs;
  }

  let dir = process.cwd();
  for (;;) {
    const candidate = join(dir, 'rawdash.config.ts');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  throw new Error(
    'Could not find rawdash.config.ts. Pass --config <path> to specify it explicitly.',
  );
}

export async function loadConfig(configPath: string): Promise<DashboardConfig> {
  const mod = await tsImport(configPath, import.meta.url);
  const config: unknown =
    (mod as { default?: unknown; config?: unknown }).default ??
    (mod as { config?: unknown }).config;
  if (!config || typeof config !== 'object') {
    throw new Error(
      `${configPath} must export a default config (result of defineConfig())`,
    );
  }
  return defineConfig(config as Parameters<typeof defineConfig>[0]);
}
