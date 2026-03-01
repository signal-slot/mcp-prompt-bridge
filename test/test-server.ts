#!/usr/bin/env node

/**
 * Test MCP server that exposes sample prompts.
 * Used to verify mcp-prompt-proxy works correctly.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "test-prompt-server",
  version: "1.0.0",
});

// Register a simple prompt with no arguments
server.prompt(
  "greeting",
  "A friendly greeting prompt",
  () => ({
    messages: [
      {
        role: "user",
        content: { type: "text", text: "Please greet the user warmly and ask how you can help today." },
      },
    ],
  })
);

// Register a prompt with arguments
server.prompt(
  "code_review",
  "Review code with specific focus areas",
  {
    language: z.string().describe("Programming language of the code"),
    focus: z.string().optional().describe("Specific area to focus on (security, performance, style)"),
  },
  ({ language, focus }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Please review the following code written in ${language}.${focus ? ` Focus especially on: ${focus}.` : ""}\nProvide detailed feedback with suggestions for improvement.`,
        },
      },
    ],
  })
);

// Register a prompt with required arguments
server.prompt(
  "translate",
  "Translate text to a target language",
  {
    target_language: z.string().describe("Target language for translation"),
    style: z.string().optional().describe("Translation style: formal, casual, technical"),
  },
  ({ target_language, style }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Translate the following text to ${target_language}.${style ? ` Use a ${style} style.` : ""}\nProvide the translation only, without explanations.`,
        },
      },
    ],
  })
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[test-server] Running with 3 prompts");
}

main().catch((err) => {
  console.error("[test-server] Error:", err);
  process.exit(1);
});
