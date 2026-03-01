#!/usr/bin/env node

/**
 * mcp-prompt-bridge
 *
 * An MCP server that connects to other MCP servers on demand,
 * discovers their prompts, and re-exposes them as tools.
 *
 * This works around the issue where Claude Code cannot see MCP prompts
 * but can see and use MCP tools.
 *
 * Usage:
 *   mcp-prompt-bridge
 *   mcp-prompt-bridge --exclude my-broken-server
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { discoverServers } from "./discover.js";
import type {
  UpstreamServerConfig,
  PromptInfo,
} from "./types.js";

/**
 * Parse CLI arguments.
 */
function parseArgs(): { servers: UpstreamServerConfig[] } {
  const args = process.argv.slice(2);
  const excludeNames: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--exclude" && args[i + 1]) {
      excludeNames.push(args[++i]);
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
  }

  const servers = discoverServers(excludeNames);

  if (servers.length === 0) {
    console.error("Error: No upstream servers found.");
    console.error(
      "No MCP servers discovered from Claude Code config files."
    );
    console.error("Run with --help for usage information.");
    process.exit(1);
  }

  return { servers };
}

function printUsage(): void {
  console.error(`
mcp-prompt-bridge - Expose MCP prompts as tools

Usage:
  mcp-prompt-bridge                             Discover and bridge all MCP servers
  mcp-prompt-bridge --exclude <name>            Exclude specific servers

Options:
  --exclude <name>     Exclude a server by name (can be repeated)
  --help, -h           Show this help

Discovery Sources (in priority order):
  1. ~/.claude.json                          (user scope)
  2. ~/.claude/settings.local.json           (user scope)
  3. ./.mcp.json                             (project scope)
  4. ./.claude/settings.local.json           (project local scope)

  If no config files found, falls back to parsing "claude mcp list" output.

  Note: HTTP/remote servers are skipped (only stdio servers supported).
  Note: "mcp-prompt-bridge" / "prompt-bridge" are auto-excluded to prevent loops.

Examples:
  mcp-prompt-bridge
  mcp-prompt-bridge --exclude slow-server --exclude broken-server
`);
}

// ─── On-demand upstream connection ──────────────────────────────────────────

/**
 * Connect to an upstream server, run a callback, then disconnect.
 */
async function withUpstream<T>(
  serverConfig: UpstreamServerConfig,
  fn: (client: Client) => Promise<T>,
  timeoutMs: number = 10000
): Promise<T> {
  const transport = new StdioClientTransport({
    command: serverConfig.command,
    args: serverConfig.args,
    env: serverConfig.env
      ? ({ ...process.env, ...serverConfig.env } as Record<string, string>)
      : undefined,
    cwd: serverConfig.cwd,
    stderr: "ignore",
  });

  const client = new Client(
    { name: "mcp-prompt-bridge", version: "1.0.0" },
    { capabilities: {} }
  );

  await Promise.race([
    client.connect(transport),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Connection timed out after ${timeoutMs}ms`)),
        timeoutMs
      )
    ),
  ]);

  try {
    return await fn(client);
  } finally {
    try {
      await client.close();
    } catch {
      // ignore
    }
  }
}

/**
 * Discover prompts from a single server (connect → listPrompts → disconnect).
 * Returns empty array if server doesn't support prompts.
 */
async function discoverPrompts(
  serverConfig: UpstreamServerConfig
): Promise<PromptInfo[]> {
  return withUpstream(serverConfig, async (client) => {
    try {
      const result = await client.listPrompts();
      return (result.prompts || []).map((p) => ({
        name: p.name,
        description: p.description,
        arguments: p.arguments?.map((a) => ({
          name: a.name,
          description: a.description,
          required: a.required,
        })),
        serverName: serverConfig.name,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Method not found") || msg.includes("-32601")) {
        return [];
      }
      throw err;
    }
  });
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { servers } = parseArgs();
  const serversByName = new Map<string, UpstreamServerConfig>();
  for (const s of servers) {
    serversByName.set(s.name, s);
  }

  console.error(
    `[bridge] Discovered ${servers.length} upstream server(s):`
  );
  for (const s of servers) {
    console.error(
      `[bridge]   - ${s.name}: ${s.command} ${(s.args ?? []).join(" ")}`
    );
  }

  // Cache for discovered prompts (populated on first list(server) call)
  const promptCache = new Map<string, PromptInfo[]>();

  // Create the bridge MCP server
  const server = new McpServer({
    name: "mcp-prompt-bridge",
    version: "1.0.0",
  });

  // ── Tool: list ──

  server.registerTool(
    "list",
    {
      title: "List Prompts",
      description:
        "Without arguments: list available MCP server names (no connection needed). " +
        "With server argument: connect to that server, list its prompts, then disconnect. " +
        "Use get() with server and prompt to fetch a specific prompt.",
      inputSchema: {
        server: z
          .string()
          .optional()
          .describe("MCP server name. Omit to list server names only."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: { server?: string }) => {
      // No server specified: return server names only (no connections)
      if (!params.server) {
        const names = Array.from(serversByName.keys());
        return {
          content: [
            {
              type: "text" as const,
              text: names.map((n) => `- ${n}`).join("\n"),
            },
          ],
        };
      }

      // Server specified: connect and list its prompts
      const serverConfig = serversByName.get(params.server);
      if (!serverConfig) {
        const available = Array.from(serversByName.keys()).join(", ");
        return {
          content: [
            {
              type: "text" as const,
              text: `Server "${params.server}" not found. Available: ${available}`,
            },
          ],
          isError: true,
        };
      }

      try {
        let prompts = promptCache.get(params.server);
        if (!prompts) {
          prompts = await discoverPrompts(serverConfig);
          promptCache.set(params.server, prompts);
        }

        if (prompts.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Server "${params.server}" has no prompts.`,
              },
            ],
          };
        }

        const lines: string[] = [];
        for (const p of prompts) {
          lines.push(`- **${p.name}**${p.description ? `: ${p.description}` : ""}`);
          if (p.arguments && p.arguments.length > 0) {
            for (const a of p.arguments) {
              const req = a.required ? "required" : "optional";
              lines.push(`  - \`${a.name}\` (${req})${a.description ? `: ${a.description}` : ""}`);
            }
          }
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error connecting to "${params.server}": ${msg}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── Tool: get ──

  server.registerTool(
    "get",
    {
      title: "Get Prompt",
      description:
        "Fetch a specific prompt from an upstream MCP server. " +
        "Connects on demand, fetches the prompt, then disconnects. " +
        "Use list() first to discover available server and prompt names.",
      inputSchema: {
        server: z.string().describe("MCP server name"),
        prompt: z.string().describe("Prompt name"),
        arguments: z
          .record(z.string())
          .optional()
          .describe("Prompt arguments as key-value pairs"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params: { server: string; prompt: string; arguments?: Record<string, string> }) => {
      const serverConfig = serversByName.get(params.server);
      if (!serverConfig) {
        const available = Array.from(serversByName.keys()).join(", ");
        return {
          content: [
            {
              type: "text" as const,
              text: `Server "${params.server}" not found. Available: ${available}`,
            },
          ],
          isError: true,
        };
      }

      try {
        return await withUpstream(serverConfig, async (client) => {
          const result = await client.getPrompt({
            name: params.prompt,
            arguments: params.arguments ?? {},
          });

          const parts: string[] = [];

          if (result.description) {
            parts.push(`# ${result.description}\n`);
          }

          for (const msg of result.messages) {
            const role = msg.role.toUpperCase();
            if (msg.content.type === "text") {
              parts.push(`[${role}]\n${msg.content.text}`);
            } else if (msg.content.type === "resource") {
              const res = msg.content.resource;
              if ("text" in res && typeof res.text === "string") {
                parts.push(`[${role} - Resource: ${res.uri}]\n${res.text}`);
              } else {
                parts.push(
                  `[${role} - Resource: ${res.uri}] (binary content, ${res.mimeType ?? "unknown type"})`
                );
              }
            } else {
              parts.push(`[${role}]\n${JSON.stringify(msg.content)}`);
            }
          }

          return {
            content: [{ type: "text" as const, text: parts.join("\n\n") }],
          };
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error fetching prompt "${params.prompt}" from "${params.server}": ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Start the bridge server over stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[bridge] mcp-prompt-bridge running (${servers.length} server(s) available)`
  );

  // Graceful shutdown
  const shutdown = async () => {
    console.error("[bridge] Shutting down...");
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[bridge] Fatal error:", err);
  process.exit(1);
});
