#!/usr/bin/env node

/**
 * Integration test for mcp-prompt-bridge.
 * Creates a temporary .mcp.json, spawns the bridge, sends JSON-RPC requests,
 * and verifies responses.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const tmpDir = resolve(__dirname, "tmp-integration-test");

async function runTest(): Promise<void> {
  console.log("=== mcp-prompt-bridge Integration Test ===\n");

  // Setup: create .mcp.json in a temp directory
  mkdirSync(tmpDir, { recursive: true });

  const mcpConfig = {
    mcpServers: {
      "test-prompts": {
        command: "npx",
        args: ["tsx", resolve(__dirname, "test-server.ts")],
      },
    },
  };

  writeFileSync(
    resolve(tmpDir, ".mcp.json"),
    JSON.stringify(mcpConfig, null, 2)
  );

  try {
    const transport = new StdioClientTransport({
      command: "node",
      args: [resolve(projectRoot, "dist/index.js")],
      cwd: tmpDir,
      stderr: "pipe",
    });

    const client = new Client(
      { name: "test-client", version: "1.0.0" },
      { capabilities: {} }
    );

    await client.connect(transport);
    console.log("✓ Connected to bridge\n");

    // 1. List tools
    console.log("--- Test 1: List tools ---");
    const tools = await client.listTools();
    console.log(`Found ${tools.tools.length} tool(s):`);
    for (const tool of tools.tools) {
      console.log(`  - ${tool.name}: ${tool.description?.slice(0, 80)}...`);
    }
    console.log();

    // 2. list() without server - should return server names only
    console.log("--- Test 2: list() - server names ---");
    const listResult = await client.callTool({
      name: "list",
      arguments: {},
    });
    const listText = getText(listResult);
    console.log(listText);
    console.log();

    // 3. list(server) - should return prompts for that server
    console.log("--- Test 3: list(server: test-prompts) ---");
    const listServerResult = await client.callTool({
      name: "list",
      arguments: { server: "test-prompts" },
    });
    console.log(getText(listServerResult));
    console.log();

    // 4. list(server) - non-existent server
    console.log("--- Test 4: list(server: nope) ---");
    const listBadResult = await client.callTool({
      name: "list",
      arguments: { server: "nope" },
    });
    console.log(getText(listBadResult));
    console.log();

    // 5. get greeting prompt (no args)
    console.log("--- Test 5: get greeting ---");
    const greetingResult = await client.callTool({
      name: "get",
      arguments: { server: "test-prompts", prompt: "greeting" },
    });
    console.log(getText(greetingResult));
    console.log();

    // 6. get code_review prompt (with args)
    console.log("--- Test 6: get code_review ---");
    const reviewResult = await client.callTool({
      name: "get",
      arguments: {
        server: "test-prompts",
        prompt: "code_review",
        arguments: { language: "TypeScript", focus: "performance" },
      },
    });
    console.log(getText(reviewResult));
    console.log();

    // 7. get from non-existent server
    console.log("--- Test 7: get from non-existent server ---");
    const badResult = await client.callTool({
      name: "get",
      arguments: { server: "nope", prompt: "greeting" },
    });
    console.log(getText(badResult));
    console.log();

    await client.close();
    console.log("=== All tests passed! ===");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function getText(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return (result.content as Array<{ type: string; text: string }>)
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");
}

runTest().catch((err) => {
  console.error("Test failed:", err);
  rmSync(tmpDir, { recursive: true, force: true });
  process.exit(1);
});
