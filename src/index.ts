#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { startHttpTransport } from "./transport/http.js";
import { logger } from "./utils/logger.js";
import { DEFAULT_API_PORT, DEFAULT_TIMEOUT } from "./constants.js";
import type { RouterOSConfig } from "./types.js";

function loadConfig(): RouterOSConfig {
  const host = process.env.MIKROTIK_HOST;
  if (!host) {
    logger.error("MIKROTIK_HOST environment variable is required");
    process.exit(1);
  }
  return {
    host,
    port: parseInt(process.env.MIKROTIK_PORT || String(DEFAULT_API_PORT)),
    username: process.env.MIKROTIK_USER || process.env.MIKROTIK_USERNAME || "admin",
    password: process.env.MIKROTIK_PASSWORD || "",
    secure: process.env.MIKROTIK_SECURE === "true",
    timeout: parseInt(process.env.MIKROTIK_TIMEOUT || String(DEFAULT_TIMEOUT)),
  };
}

async function runStdio(): Promise<void> {
  const config = loadConfig();
  const { server, client } = createServer(config);
  const exitHandler = async () => {
    logger.info("Exiting...");
    await client.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", exitHandler);
  process.on("SIGTERM", exitHandler);
  process.on("SIGHUP", exitHandler);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("MikroTik MCP Server running via stdio", {
    host: config.host,
    port: config.port,
  });
}

async function runHttp(): Promise<void> {
  const config = loadConfig();
  const { server, client } = createServer(config);

  const httpHost = process.env.MCP_HTTP_HOST || "0.0.0.0";
  const httpPort = parseInt(process.env.MCP_HTTP_PORT || "3000", 10);
  const token = process.env.MIKROTIK_MCP_TOKEN;

  if (!token && httpHost !== "127.0.0.1" && httpHost !== "localhost") {
    logger.warn(
      "MIKROTIK_MCP_TOKEN is not set but server is binding to a non-loopback interface. " +
        "Anyone on the network can control your router. Set MIKROTIK_MCP_TOKEN or bind to 127.0.0.1."
    );
  }

  const { close } = await startHttpTransport(server, {
    host: httpHost,
    port: httpPort,
    token,
  });

  const exitHandler = async () => {
    logger.info("Exiting...");
    await close();
    await client.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", exitHandler);
  process.on("SIGTERM", exitHandler);
  process.on("SIGHUP", exitHandler);

  logger.info("MikroTik MCP Server running via HTTP", {
    mikrotikHost: config.host,
    httpUrl: `http://${httpHost}:${httpPort}/mcp`,
  });
}

const transport = (process.env.MCP_TRANSPORT || "stdio").toLowerCase();
const run = transport === "http" ? runHttp : runStdio;

run().catch((error) => {
  logger.error("Fatal error", { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
