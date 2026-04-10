import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

function metabaseHeaders(): HeadersInit {
  const apiKey = process.env.METABASE_API_KEY?.trim();
  const session = process.env.METABASE_SESSION_TOKEN?.trim();
  if (apiKey) {
    return {
      "X-Api-Key": apiKey,
      "Content-Type": "application/json",
    };
  }
  if (session) {
    return {
      "X-Metabase-Session": session,
      "Content-Type": "application/json",
    };
  }
  throw new Error(
    "Set METABASE_API_KEY or METABASE_SESSION_TOKEN in the environment."
  );
}

async function metabaseFetch(path: string, init?: RequestInit): Promise<unknown> {
  const base = requireEnv("METABASE_URL").replace(/\/$/, "");
  const url = path.startsWith("http") ? path : `${base}/api${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      ...metabaseHeaders(),
      ...(init?.headers as Record<string, string>),
    },
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg =
      typeof body === "object" && body !== null && "message" in body
        ? String((body as { message: unknown }).message)
        : text.slice(0, 500);
    throw new Error(`Metabase ${res.status}: ${msg}`);
  }
  return body;
}

const server = new Server(
  {
    name: "zillion-metabase-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "metabase_list_databases",
      description:
        "List Metabase databases the current credentials can access.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "metabase_list_tables",
      description:
        "List tables (metadata) for a Metabase database id from /api/database/:id/metadata.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: {
            type: "integer",
            description: "Metabase database id",
          },
        },
        required: ["database_id"],
        additionalProperties: false,
      },
    },
    {
      name: "metabase_search_cards",
      description:
        "Search saved questions/cards. Uses Metabase search API when available.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search text",
          },
          limit: {
            type: "integer",
            description: "Max results (default 20)",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    {
      name: "metabase_get_card",
      description: "Fetch a saved question/card by id (GET /api/card/:id).",
      inputSchema: {
        type: "object",
        properties: {
          card_id: {
            type: "integer",
            description: "Metabase card id",
          },
        },
        required: ["card_id"],
        additionalProperties: false,
      },
    },
    {
      name: "metabase_run_native_query",
      description:
        "Run a read-only SQL query against a Metabase database via POST /api/dataset (type native). Respect your org's SQL and RLS policies.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: {
            type: "integer",
            description: "Metabase database id",
          },
          sql: {
            type: "string",
            description: "Native SQL to execute",
          },
        },
        required: ["database_id", "sql"],
        additionalProperties: false,
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, unknown>;

  try {
    switch (name) {
      case "metabase_list_databases": {
        const data = await metabaseFetch("/database");
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }
      case "metabase_list_tables": {
        const id = Number(a.database_id);
        const data = await metabaseFetch(`/database/${id}/metadata`);
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }
      case "metabase_search_cards": {
        const q = String(a.query ?? "");
        const limit = Math.min(Number(a.limit ?? 20) || 20, 100);
        const params = new URLSearchParams({
          q,
          models: "card",
          limit: String(limit),
        });
        const data = await metabaseFetch(`/search?${params.toString()}`);
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }
      case "metabase_get_card": {
        const cardId = Number(a.card_id);
        const data = await metabaseFetch(`/card/${cardId}`);
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }
      case "metabase_run_native_query": {
        const databaseId = Number(a.database_id);
        const sql = String(a.sql ?? "");
        const body = {
          database: databaseId,
          type: "native",
          native: { query: sql },
        };
        const data = await metabaseFetch("/dataset", {
          method: "POST",
          body: JSON.stringify(body),
        });
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }
      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      content: [{ type: "text", text: message }],
      isError: true,
    };
  }
});

async function main() {
  requireEnv("METABASE_URL");
  metabaseHeaders();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
