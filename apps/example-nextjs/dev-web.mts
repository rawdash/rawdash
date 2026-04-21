import { spawn } from 'child_process';

const port = process.env['PORT'] ?? '8080';
const healthUrl = `http://localhost:${port}/health`;

async function waitForServer(): Promise<void> {
  const timeoutMs = 30_000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(healthUrl);
      if (res.ok) return;
    } catch (_e) {
      void _e;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${healthUrl} after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

await waitForServer().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

const next = spawn('next', ['dev', '--turbopack'], { stdio: 'inherit', shell: true });
next.on('error', (err) => {
  console.error('Failed to start Next.js dev server:', err);
  process.exit(1);
});
next.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
