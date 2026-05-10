import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';

import type { McpServerOptions } from '../types';
import { err, text } from './shared';

const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]*$/;

export function registerSetSecret(
  server: McpServer,
  trackedSecrets: Set<string>,
  options: Pick<McpServerOptions, 'onSetSecret'>,
): void {
  server.tool(
    'set_secret',
    'Set a secret for the running Rawdash instance. Secret names must be uppercase (e.g. GITHUB_TOKEN). For OSS, secrets are stored in process.env (runtime-only, not persisted).',
    {
      name: z
        .string()
        .describe(
          'Secret name — uppercase letters, digits, and underscores; must start with a letter (e.g. GITHUB_TOKEN).',
        ),
      value: z.string().describe('The secret value.'),
    },
    async ({ name, value }) => {
      if (!SECRET_NAME_RE.test(name)) {
        return err(
          'INVALID_NAME',
          `Secret name "${name}" is invalid. Must match /^[A-Z][A-Z0-9_]*$/.`,
        );
      }

      try {
        if (options.onSetSecret) {
          await options.onSetSecret(name, value);
        } else {
          const env = (
            globalThis as {
              process?: { env?: Record<string, string | undefined> };
            }
          ).process?.env;
          if (!env) {
            return err(
              'NO_SECRET_BACKEND',
              'No secret backend is configured for this runtime.',
            );
          }
          env[name] = value;
        }
      } catch (e) {
        return err(
          'SET_SECRET_FAILED',
          e instanceof Error ? e.message : 'Failed to set secret.',
        );
      }

      trackedSecrets.add(name);

      return text({ set: name });
    },
  );
}
