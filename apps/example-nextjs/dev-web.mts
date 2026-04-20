import { spawn } from 'child_process';

const port = process.env['PORT'] ?? '8080';
const healthUrl = `http://localhost:${port}/health`;

async function waitForServer(): Promise<void> {
  for (;;) {
    try {
      const res = await fetch(healthUrl);
      if (res.ok) return;
    } catch (_e) {
      void _e;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

await waitForServer();

const next = spawn('next', ['dev', '--turbopack'], { stdio: 'inherit', shell: true });
next.on('exit', (code) => process.exit(code ?? 0));
