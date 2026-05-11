# @rawdash/mcp

[![npm version](https://img.shields.io/npm/v/@rawdash/mcp)](https://www.npmjs.com/package/@rawdash/mcp)
[![license](https://img.shields.io/npm/l/@rawdash/mcp)](LICENSE)

MCP server exposing rawdash dashboards to LLMs and AI agents.

## What it is

`@rawdash/mcp` implements the [Model Context Protocol](https://modelcontextprotocol.io/) on top of a rawdash config. It gives any MCP-compatible AI assistant (Claude, Cursor, etc.) direct tool access to your dashboards: listing dashboards and widgets, reading widget data, managing connectors, handling secrets, and triggering syncs — all as structured tool calls.

## Install

```sh
npm install @rawdash/mcp
```

## Quick example

```ts
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio';
import { createMcpServer } from '@rawdash/mcp';

import config from './rawdash.config';
import { storage } from './storage';

const server = createMcpServer({ config, storage });
await server.connect(new StdioServerTransport());
```

## Claude Desktop config

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "rawdash": {
      "command": "node",
      "args": ["/path/to/your/mcp-server.js"]
    }
  }
}
```

## Available tools

| Tool               | Description                                     |
| ------------------ | ----------------------------------------------- |
| `list_dashboards`  | List all configured dashboards                  |
| `list_widgets`     | List widgets in a dashboard                     |
| `read_widget`      | Read cached data for a widget                   |
| `render_widget`    | Render a widget as formatted text               |
| `list_connectors`  | List configured connectors and their sync state |
| `add_connector`    | Add a new connector at runtime                  |
| `remove_connector` | Remove a connector                              |
| `trigger_sync`     | Trigger an immediate data sync                  |
| `set_secret`       | Set a secret value                              |
| `list_secrets`     | List tracked secret names                       |

## API

### `createMcpServer(options): McpServer`

Creates and returns an `McpServer` instance with all tools registered. Options:

| Option    | Type              | Description                               |
| --------- | ----------------- | ----------------------------------------- |
| `config`  | `DashboardConfig` | Your rawdash config (from `defineConfig`) |
| `storage` | `ServerStorage`   | Storage backend (e.g. `TursoStorage`)     |
| `name`    | `string`          | MCP server name (default: `'rawdash'`)    |
| `version` | `string`          | MCP server version (default: `'1.0.0'`)   |

## Links

- [rawdash docs](https://rawdash.dev)
- [GitHub](https://github.com/rawdash/rawdash)
- [Issues](https://github.com/rawdash/rawdash/issues)

## License

Apache-2.0
