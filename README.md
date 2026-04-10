# zillion-metabase-mcp

A small [Model Context Protocol](https://modelcontextprotocol.io/) server that talks to your [Metabase](https://www.metabase.com/) instance over its HTTP API. It exposes tools to list databases and tables, search and fetch saved questions, and run native SQL queries (subject to Metabase permissions and your data policies).

## Requirements

- Node.js 20+
- A Metabase instance and credentials with API access

## Setup

```bash
npm install
cp .env.example .env
# Edit .env: METABASE_URL and either METABASE_API_KEY or METABASE_SESSION_TOKEN
npm run build
```

Environment variables:

| Variable | Description |
|----------|-------------|
| `METABASE_URL` | Base URL of Metabase (no trailing slash), e.g. `https://metabase.example.com` |
| `METABASE_API_KEY` | API key (Metabase 50+), preferred |
| `METABASE_SESSION_TOKEN` | Alternative: session token from `POST /api/session` |

## Run

The server speaks MCP over stdio (standard for MCP hosts):

```bash
npm start
```

Wire this command into your MCP-capable client using that client’s own configuration UI or docs. This repository does not ship editor-specific MCP config files.

## Tools

- **metabase_list_databases** — List databases visible to the user.
- **metabase_list_tables** — Metadata for a database (`database_id`).
- **metabase_search_cards** — Search saved questions (`query`, optional `limit`).
- **metabase_get_card** — Fetch a card by `card_id`.
- **metabase_run_native_query** — Run native SQL (`database_id`, `sql`) via `/api/dataset`.

## License

MIT
