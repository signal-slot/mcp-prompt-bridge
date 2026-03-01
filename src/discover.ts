/**
 * Auto-discovery of MCP servers from Claude Code configuration.
 *
 * Reads from multiple sources:
 * 1. Claude Code config files (.mcp.json, ~/.claude.json, ~/.claude/settings.local.json)
 * 2. `claude mcp list` CLI output (fallback)
 *
 * Excludes self (mcp-prompt-bridge) to avoid circular connections.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import type { UpstreamServerConfig } from "./types.js";

/** Shape of mcpServers in Claude Code config files */
interface McpServerEntry {
  command?: string;
  type?: string;    // "stdio" | "http"
  url?: string;     // for http type
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

interface McpConfigFile {
  mcpServers?: Record<string, McpServerEntry>;
  projects?: Record<string, { mcpServers?: Record<string, McpServerEntry> }>;
}

/**
 * Get the resolved path of our own entry point, used to detect self.
 */
function getSelfPath(): string | undefined {
  // process.argv[1] is our dist/index.js
  try {
    return resolve(process.argv[1]);
  } catch {
    return undefined;
  }
}

/**
 * Check if a server config points to ourselves.
 */
function isSelf(server: UpstreamServerConfig, selfPath: string | undefined): boolean {
  if (!selfPath) return false;
  // Check if any of the server's args resolve to our own entry point
  for (const arg of server.args ?? []) {
    try {
      if (resolve(arg) === selfPath) return true;
    } catch {
      // ignore
    }
  }
  return false;
}

/**
 * Discover MCP servers from all available sources.
 * @param excludeNames Additional server names to exclude
 * @param cwd Working directory to search for project configs
 */
export function discoverServers(
  excludeNames: string[] = [],
  cwd: string = process.cwd()
): UpstreamServerConfig[] {
  const excludeSet = new Set(excludeNames);
  const selfPath = getSelfPath();
  const servers = new Map<string, UpstreamServerConfig>();

  // 1. Read config files (lower priority first, higher priority overwrites)
  const configPaths = getConfigPaths(cwd);
  for (const configPath of configPaths) {
    const discovered = readConfigFile(configPath, cwd);
    for (const server of discovered) {
      if (excludeSet.has(server.name)) continue;
      if (isSelf(server, selfPath)) {
        console.error(`[auto-discover] Skipping "${server.name}" (self)`);
        continue;
      }
      servers.set(server.name, server);
    }
  }

  // 2. If no servers found from config files, try CLI
  if (servers.size === 0) {
    console.error("[auto-discover] No servers found in config files, trying claude mcp list...");
    const cliServers = parseClaudeMcpList();
    for (const server of cliServers) {
      if (excludeSet.has(server.name)) continue;
      if (isSelf(server, selfPath)) continue;
      servers.set(server.name, server);
    }
  }

  return Array.from(servers.values());
}

/**
 * Get all config file paths to check, in order of priority (low → high).
 */
function getConfigPaths(cwd: string): string[] {
  const home = homedir();
  const paths: string[] = [];

  // User-level configs (lowest priority)
  paths.push(join(home, ".claude.json"));
  paths.push(join(home, ".claude", "settings.local.json"));

  // Project-level configs (higher priority)
  paths.push(join(cwd, ".mcp.json"));
  paths.push(join(cwd, ".claude", "settings.local.json"));
  paths.push(join(cwd, ".claude", ".mcp.json"));

  return paths;
}

/**
 * Read and parse a single Claude Code config file.
 * For ~/.claude.json, also reads the project-scoped mcpServers under projects[cwd].
 */
function readConfigFile(filePath: string, cwd: string): UpstreamServerConfig[] {
  if (!existsSync(filePath)) {
    return [];
  }

  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as McpConfigFile;

    const servers: UpstreamServerConfig[] = [];

    // Top-level mcpServers
    if (parsed.mcpServers) {
      servers.push(...extractServers(parsed.mcpServers, filePath));
    }

    // Project-scoped mcpServers (e.g. ~/.claude.json projects[cwd].mcpServers)
    if (parsed.projects) {
      const resolvedCwd = resolve(cwd);
      const projectConfig = parsed.projects[resolvedCwd];
      if (projectConfig?.mcpServers) {
        servers.push(...extractServers(projectConfig.mcpServers, `${filePath} [project: ${resolvedCwd}]`));
      }
    }

    if (servers.length > 0) {
      console.error(`[auto-discover] Found ${servers.length} server(s) in ${filePath}`);
    }

    return servers;
  } catch (err) {
    console.error(
      `[auto-discover] Failed to read ${filePath}:`,
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

function extractServers(mcpServers: Record<string, McpServerEntry>, source: string): UpstreamServerConfig[] {
  const servers: UpstreamServerConfig[] = [];

  for (const [name, entry] of Object.entries(mcpServers)) {
    if (entry.type === "http" || entry.url) {
      console.error(`[auto-discover] Skipping "${name}" (HTTP transport not supported)`);
      continue;
    }

    if (!entry.command) {
      console.error(`[auto-discover] Skipping "${name}" (no command specified)`);
      continue;
    }

    servers.push({
      name,
      command: entry.command,
      args: entry.args,
      env: entry.env,
      cwd: entry.cwd,
    });
  }

  return servers;
}

/**
 * Parse `claude mcp list` output as a fallback.
 *
 * Expected format:
 *   server-name (scope): command args - ✓ Connected
 *   server-name: command args - ✓ Connected
 */
function parseClaudeMcpList(): UpstreamServerConfig[] {
  try {
    const output = execSync("claude mcp list 2>/dev/null", {
      encoding: "utf-8",
      timeout: 15000,
    });

    const servers: UpstreamServerConfig[] = [];

    // Match lines like: name (scope): command args - ✓ Connected
    // or: name: command args - ✓ Connected
    const lineRegex = /^(\S+?)(?:\s+\([^)]+\))?:\s+(.+?)\s+-\s+[✓✗]/;

    for (const line of output.split("\n")) {
      const match = line.match(lineRegex);
      if (!match) continue;

      const name = match[1].trim();
      const commandLine = match[2].trim();
      const parts = commandLine.split(/\s+/);
      const command = parts[0];
      const args = parts.slice(1);

      if (command) {
        servers.push({ name, command, args });
      }
    }

    if (servers.length > 0) {
      console.error(`[auto-discover] Found ${servers.length} server(s) from claude mcp list`);
    }

    return servers;
  } catch (err) {
    console.error(
      "[auto-discover] claude mcp list failed:",
      err instanceof Error ? err.message : "command not found or timed out"
    );
    return [];
  }
}
