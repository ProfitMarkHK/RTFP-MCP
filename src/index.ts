#!/usr/bin/env bun
/**
 * RTFP-MCP entry point.
 *
 * A Model Context Protocol server exposing the GFO-X RTFP market data API
 * (BTC futures, options and strategies) over stdio. Built on Anthropic's
 * official MCP TypeScript SDK.
 *
 * Usage:
 *   rtfp-mcp                # stdio transport (the default; use with MCP clients)
 *
 * Environment:
 *   RTFP_BASE_URL  override the API base URL (default: the public GFO-X host)
 *   RTFP_MOCK=1    talk to a local RTFP look-alike (see src/mock-server.ts,
 *                  `bun run mock`) instead of the real venue
 *   RTFP_DEMO=1    serve canned responses instead of any HTTP API (offline demo)
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { DEFAULT_BASE_URL, RtfpClient } from "./client.js";
import { demoTransport } from "./demo.js";
import { MOCK_DEFAULT_PORT } from "./mock-server.js";
import { ServerContext, buildServer } from "./server.js";

function resolveBaseUrl(): { demo: boolean; baseUrl: string } {
  if (process.env.RTFP_DEMO === "1") return { demo: true, baseUrl: DEFAULT_BASE_URL };
  if (process.env.RTFP_MOCK === "1") {
    const port = process.env.MOCK_PORT ?? String(MOCK_DEFAULT_PORT);
    return { demo: false, baseUrl: `http://127.0.0.1:${port}` };
  }
  return { demo: false, baseUrl: process.env.RTFP_BASE_URL || DEFAULT_BASE_URL };
}

async function main(): Promise<void> {
  const { demo, baseUrl } = resolveBaseUrl();
  const context = new ServerContext(
    demo ? new RtfpClient({ transport: demoTransport }) : new RtfpClient({ baseUrl }),
  );
  const server = buildServer(context);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`rtfp-mcp serving on stdio (${demo ? "DEMO data" : `API: ${baseUrl}`})`);
}

main().catch((error: unknown) => {
  console.error("rtfp-mcp fatal:", error);
  process.exit(1);
});
