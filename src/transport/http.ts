/**
 * Streamable HTTP transport for MCP. Exposes the server over the network so
 * Claude Code (or any MCP client) can connect remotely via `/mcp`.
 *
 * Stateful mode: each client initializes a session and receives an
 * `Mcp-Session-Id` header that it echoes on subsequent requests.
 *
 * Auth: if MIKROTIK_MCP_TOKEN is set, the server requires
 * `Authorization: Bearer <token>` on every request. Strongly recommended
 * when exposing beyond localhost.
 */

import { randomUUID } from "node:crypto";
import express, { type Request, type Response, type NextFunction } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logger } from "../utils/logger.js";

export interface HttpTransportOptions {
  host: string;
  port: number;
  token?: string;
  path?: string;
}

export async function startHttpTransport(
  server: McpServer,
  opts: HttpTransportOptions
): Promise<{ close: () => Promise<void> }> {
  const app = express();
  app.use(express.json({ limit: "4mb" }));

  const path = opts.path ?? "/mcp";
  const transports: Record<string, StreamableHTTPServerTransport> = {};

  const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
    if (!opts.token) return next();
    const header = req.headers.authorization || "";
    const expected = `Bearer ${opts.token}`;
    if (header !== expected) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized" },
        id: null,
      });
      return;
    }
    next();
  };

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, sessions: Object.keys(transports).length });
  });

  app.post(path, requireAuth, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport: StreamableHTTPServerTransport | undefined;

    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          if (transport) transports[sid] = transport;
          logger.info("MCP session initialized", { sessionId: sid });
        },
      });
      transport.onclose = () => {
        if (transport?.sessionId) {
          delete transports[transport.sessionId];
          logger.info("MCP session closed", { sessionId: transport.sessionId });
        }
      };
      await server.connect(transport);
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: no valid session ID or non-initialize request without session",
        },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  });

  const handleSessionRequest = async (req: Request, res: Response): Promise<void> => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const transport = sessionId ? transports[sessionId] : undefined;
    if (!transport) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    await transport.handleRequest(req, res);
  };

  app.get(path, requireAuth, handleSessionRequest);
  app.delete(path, requireAuth, handleSessionRequest);

  const httpServer = app.listen(opts.port, opts.host, () => {
    logger.info("MikroTik MCP Server listening (HTTP)", {
      url: `http://${opts.host}:${opts.port}${path}`,
      authRequired: !!opts.token,
    });
  });

  return {
    close: async () => {
      for (const t of Object.values(transports)) {
        try {
          await t.close();
        } catch {
          // ignore transport close errors during shutdown
        }
      }
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
