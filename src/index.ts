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
 *   RTFP_DEMO=1    serve canned responses instead of the live API (offline demo)
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { DEFAULT_BASE_URL, RtfpClient } from "./client.js";
import { demoTransport } from "./demo.js";
import { ServerContext, buildServer } from "./server.js";

async function main(): Promise<void> {
  const demo = process.env.RTFP_DEMO === "1";
  const baseUrl = process.env.RTFP_BASE_URL || DEFAULT_BASE_URL;
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
