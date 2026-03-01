#!/usr/bin/env node

/**
 * Integration test for auto-discovery features.
 * Creates a fake .mcp.json, runs bridge, verifies self-exclusion and HTTP filtering.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const tmpDir = resolve(__dirname, "tmp-auto-test");

async function runTest(): Promise<void> {
  console.log("=== mcp-prompt-bridge Auto-Discovery Integration Test ===\n");

  mkdirSync(tmpDir, { recursive: true });

  const mcpConfig = {
    mcpServers: {
      "test-prompts": {
        command: "npx",
        args: ["tsx", resolve(__dirname, "test-server.ts")],
      },
      "remote-server": {
        type: "http",
        url: "https://example.com/mcp",
      },
      "myself": {
        command: "node",
        args: [resolve(projectRoot, "dist/index.js")],
      },
    },
  };

  writeFileSync(
    resolve(tmpDir, ".mcp.json"),
    JSON.stringify(mcpConfig, null, 2)
  );

  console.log("Created .mcp.json in:", tmpDir);
  console.log();

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

    let allPassed = true;

    // list() should return only test-prompts (self and HTTP excluded)
    console.log("--- Test 1: list() - server names ---");
    const listResult = await client.callTool({ name: "list", arguments: {} });
    const listText = getText(listResult);
    console.log(listText);
    console.log();

    const hasTestPrompts = listText.includes("test-prompts");
    console.log(`${hasTestPrompts ? "✓" : "✗"} test-prompts present: ${hasTestPrompts ? "PASS" : "FAIL"}`);
    if (!hasTestPrompts) allPassed = false;

    const selfExcluded = !listText.includes("myself");
    console.log(`${selfExcluded ? "✓" : "✗"} Self-exclusion (same binary): ${selfExcluded ? "PASS" : "FAIL"}`);
    if (!selfExcluded) allPassed = false;

    const httpSkipped = !listText.includes("remote-server");
    console.log(`${httpSkipped ? "✓" : "✗"} HTTP server skipped: ${httpSkipped ? "PASS" : "FAIL"}`);
    if (!httpSkipped) allPassed = false;
    console.log();

    // list(server) should return prompts
    console.log("--- Test 2: list(server: test-prompts) ---");
    const promptsResult = await client.callTool({
      name: "list",
      arguments: { server: "test-prompts" },
    });
    const promptsText = getText(promptsResult);
    console.log(promptsText);
    const hasGreeting = promptsText.includes("greeting");
    console.log(`${hasGreeting ? "✓" : "✗"} greeting prompt found: ${hasGreeting ? "PASS" : "FAIL"}`);
    if (!hasGreeting) allPassed = false;
    console.log();

    // get() should work
    console.log("--- Test 3: get greeting ---");
    const greetingResult = await client.callTool({
      name: "get",
      arguments: { server: "test-prompts", prompt: "greeting" },
    });
    const greetingText = getText(greetingResult);
    console.log(greetingText);
    const greetingOk = greetingText.includes("greet the user");
    console.log(`${greetingOk ? "✓" : "✗"} Greeting prompt content: ${greetingOk ? "PASS" : "FAIL"}`);
    if (!greetingOk) allPassed = false;
    console.log();

    await client.close();

    if (allPassed) {
      console.log("=== All tests passed! ===");
    } else {
      console.error("=== Some tests FAILED ===");
      process.exitCode = 1;
    }
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
