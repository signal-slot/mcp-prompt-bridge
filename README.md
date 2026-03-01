# mcp-prompt-bridge

**An MCP server that re-exposes other MCP servers' prompts as tools**

Workaround for Claude Code not being able to see MCP prompts ([#11054](https://github.com/anthropics/claude-code/issues/11054), [#3210](https://github.com/anthropics/claude-code/issues/3210)).

## How It Works

```
[Claude Code]
    ↓ calls as tools
[mcp-prompt-bridge]
    ↓ connects as MCP client (on demand)
[Upstream MCP Server A] [Server B] ...
    prompts/list → discover prompts
    prompts/get  → fetch and return
```

Connections to upstream servers are on demand — the bridge connects only when `list` / `get` is called, then disconnects immediately.

## Usage

```json
{
  "mcpServers": {
    "prompt-bridge": {
      "command": "npx",
      "args": ["mcp-prompt-bridge"]
    }
  }
}
```

Or via CLI:

```bash
claude mcp add prompt-bridge -- npx mcp-prompt-bridge
```

### Excluding Specific Servers

```json
{
  "mcpServers": {
    "prompt-bridge": {
      "command": "npx",
      "args": ["mcp-prompt-bridge", "--exclude", "slow-server"]
    }
  }
}
```

## Server Discovery

Reads Claude Code config files in priority order (later entries override earlier ones):

1. `~/.claude.json` — user scope (including project-scoped entries under `projects[cwd]`)
2. `~/.claude/settings.local.json` — user local
3. `./.mcp.json` — project scope
4. `./.claude/settings.local.json` — project local

Falls back to parsing `claude mcp list` output if no config files are found.

## Safety

- **Self-exclusion**: automatically skips servers with the same entry point path (prevents circular connections)
- **HTTP filtering**: HTTP/SSE transport servers are skipped (stdio only)
- **Graceful handling**: servers that don't support prompts are silently skipped
- **Timeout**: connections time out after 10 seconds
- **On-demand connections**: no servers are spawned at startup

## Exposed Tools

### `list`

Without arguments: returns available server names (no connection needed).
With `server` argument: connects to that server and returns its prompts.

### `get`

Fetches a specific prompt from an upstream server.

| Argument | Description |
|----------|-------------|
| `server` | MCP server name |
| `prompt` | Prompt name |
| `arguments` | Prompt arguments as key-value pairs (optional) |

## CLI Options

| Option | Description |
|--------|-------------|
| `--exclude <name>` | Exclude a server by name (repeatable) |
| `--help`, `-h` | Show help |

## Limitations

- stdio transport only (HTTP/SSE servers not supported)
- No dynamic prompt refresh (restart required)
- Binary resource content in prompts shows metadata only

## License

MIT
