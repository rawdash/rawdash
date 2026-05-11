# @rawdash/cli

[![npm version](https://img.shields.io/npm/v/@rawdash/cli)](https://www.npmjs.com/package/@rawdash/cli)
[![license](https://img.shields.io/npm/l/@rawdash/cli)](LICENSE)

Deploy and manage your rawdash config from the terminal.

## What it is

`@rawdash/cli` is the command-line interface for rawdash. It lets you validate your config locally, deploy it to the rawdash server, and manage secrets — all from your terminal or CI pipeline. It reads your `rawdash.config.ts` file and communicates with the rawdash API.

## Install

```sh
npm install -g @rawdash/cli
# or use without installing:
npx @rawdash/cli <command>
```

Requires Node.js 24+.

## Quick example

```sh
# Validate your config file locally (no network)
npx @rawdash/cli validate

# Preview what would change before deploying
npx @rawdash/cli deploy --dry-run

# Deploy to the server
RAWDASH_API_KEY=your-key npx @rawdash/cli deploy

# Manage secrets
npx @rawdash/cli secrets set GITHUB_TOKEN ghp_...
npx @rawdash/cli secrets list
npx @rawdash/cli secrets remove GITHUB_TOKEN
```

## Commands

| Command                      | Description                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------- |
| `validate`                   | Validate `rawdash.config.ts` locally without network access                      |
| `deploy`                     | Deploy config to the server (use `--dry-run` to preview, `--yes` to skip prompt) |
| `secrets set <name> [value]` | Set a secret (reads from stdin if value is omitted)                              |
| `secrets list`               | List all secret names and last-rotation timestamps                               |
| `secrets remove <name>`      | Delete a secret                                                                  |

## Configuration

The CLI expects the following environment variables:

| Variable          | Required                 | Description                                      |
| ----------------- | ------------------------ | ------------------------------------------------ |
| `RAWDASH_API_KEY` | Yes (for deploy/secrets) | API key for the rawdash server                   |
| `RAWDASH_URL`     | No                       | Server base URL (defaults to the hosted service) |

## Links

- [rawdash docs](https://rawdash.dev)
- [GitHub](https://github.com/rawdash/rawdash)
- [Issues](https://github.com/rawdash/rawdash/issues)

## License

Apache-2.0
