# example-server

Minimal self-hosted Rawdash server using `@rawdash/server` with `@rawdash/turso` for persistent SQLite storage and `@rawdash/github` as the connector.

## Local dev

```bash
cp .env.example .env.local
# fill in GITHUB_TOKEN
pnpm dev
```

Data is persisted to `rawdash.db` in the current directory by default — no Turso account needed.

## Deployment

To deploy on a VM, Railway, Fly, Render, or any persistent host:

1. Set `TURSO_URL` and `TURSO_AUTH_TOKEN` to point at a remote Turso database.
2. Set `GITHUB_TOKEN`, `GITHUB_OWNER`, and `GITHUB_REPO` for your repository.
3. Export the environment variables in the host shell (the `start` script does not auto-load `.env.local`), then run `pnpm start`:

```bash
export GITHUB_TOKEN=... GITHUB_OWNER=... GITHUB_REPO=... TURSO_URL=... TURSO_AUTH_TOKEN=...
pnpm start
```

The `apps/example-nextjs` dashboard can connect to this server by setting `RAWDASH_URL` to the server's address.
