#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { logger } from "./utils/logger.js";
import { DEFAULT_API_PORT, DEFAULT_TIMEOUT } from "./constants.js";
import type { RouterOSConfig } from "./types.js";
function loadConfig(): RouterOSConfig {
  const host = process.env.ROUTEROS_HOST;
  if (!host) {
    logger.error("ROUTEROS_HOST environment variable is required");
    process.exit(1);
  }
  return {
    host,
    port: parseInt(process.env.ROUTEROS_PORT || String(DEFAULT_API_PORT)),
    username: process.env.ROUTEROS_USERNAME || "admin",
    password: process.env.ROUTEROS_PASSWORD || "",
    secure: process.env.ROUTEROS_SECURE === "true",
    timeout: parseInt(process.env.ROUTEROS_TIMEOUT || String(DEFAULT_TIMEOUT)),
  };
}
async function runStdio(): Promise<void> {
  const config = loadConfig();
  const { server, client } = createServer(config);
  const exit_handler = async () => {
    logger.info("Exiting...");
    await client.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", exit_handler);
  process.on("SIGTERM", exit_handler);
  process.on("SIGHUP", exit_handler);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("MikroTik MCP Server running via stdio", {
    host: config.host,
    port: config.port,
  });
}
runStdio().catch((error) => {
  logger.error("Fatal error", { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
