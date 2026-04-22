#!/usr/bin/env node
// Side-effect import MUST be first: patches node-routeros before any
// RouterOSAPI / Channel is constructed.
import { applyNodeRouterOsPatches } from "./routeros/patches.js";
applyNodeRouterOsPatches();

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { startHttpTransport } from "./transport/http.js";
import { logger } from "./utils/logger.js";
import { DEFAULT_API_PORT, DEFAULT_TIMEOUT, SERVER_VERSION } from "./constants.js";
import type { RouterOSConfig } from "./types.js";

// Belt-and-suspenders: if anything RouterOS-library-related ever bubbles up
// as an uncaught exception (e.g., a future node-routeros path we haven't
// patched, or an event-callback throw we missed), log and continue instead
// of crashing the whole MCP server.
process.on("uncaughtException", (err: Error & { errno?: string; code?: string }) => {
  const errno = err?.errno || err?.code || "";
  if (errno === "UNKNOWNREPLY" || (err?.name === "RosException" && /UNKNOWNREPLY/.test(err?.message ?? ""))) {
    logger.warn("swallowed node-routeros UNKNOWNREPLY from event callback", {
      message: err.message,
    });
    return;
  }
  logger.error("uncaughtException (fatal)", {
    name: err?.name,
    message: err?.message,
    stack: err?.stack,
  });
  // Preserve fail-fast for genuinely unexpected errors.
  process.exit(1);
});

process.on("unhandledRejection", (reason: unknown) => {
  logger.error("unhandledRejection", {
    reason: reason instanceof Error ? { message: reason.message, stack: reason.stack } : reason,
  });
});

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
    version: SERVER_VERSION,
    host: config.host,
    port: config.port,
  });
}

async function runHttp(): Promise<void> {
  const config = loadConfig();

  const httpHost = process.env.MCP_HTTP_HOST || "0.0.0.0";
  const httpPort = parseInt(process.env.MCP_HTTP_PORT || "3000", 10);
  const token = process.env.MIKROTIK_MCP_TOKEN;

  if (!token && httpHost !== "127.0.0.1" && httpHost !== "localhost") {
    logger.warn(
      "MIKROTIK_MCP_TOKEN is not set but server is binding to a non-loopback interface. " +
        "Anyone on the network can control your router. Set MIKROTIK_MCP_TOKEN or bind to 127.0.0.1."
    );
  }

  // McpServer can only bind to one transport at a time — build a fresh
  // server (+ its own RouterOSClient) per session.
  const { close } = await startHttpTransport(
    () => {
      const { server, client } = createServer(config);
      return {
        server,
        close: async () => {
          await client.disconnect();
        },
      };
    },
    { host: httpHost, port: httpPort, token }
  );

  const exitHandler = async () => {
    logger.info("Exiting...");
    await close();
    process.exit(0);
  };
  process.on("SIGINT", exitHandler);
  process.on("SIGTERM", exitHandler);
  process.on("SIGHUP", exitHandler);

  logger.info("MikroTik MCP Server running via HTTP", {
    version: SERVER_VERSION,
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
