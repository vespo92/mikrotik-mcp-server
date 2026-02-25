import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DiscoveryService, DiscoveredEndpoint, EndpointSchema } from "../discovery/service.js";
import { handleRouterOSError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

/**
 * Execute an async operation with a timeout.
 * Returns the result or throws a timeout error.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function registerDiscoveryTools(
  server: McpServer,
  discoveryService: DiscoveryService
): void {
  server.registerTool(
    "mikrotik_discover_endpoints",
    {
      title: "Discover MikroTik API Endpoints",
      description:
        "Discover available MikroTik API endpoints at a given path. " +
        "Returns a list of child endpoints with their names and paths. " +
        "Use without arguments to list root-level endpoints, or specify a path to explore deeper.",
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe("Optional path to discover endpoints under. Defaults to root."),
      },
      outputSchema: {
        endpoints: z
          .array(
            z.object({
              name: z.string().describe("Endpoint name"),
              path: z.string().describe("Full endpoint path"),
            })
          )
          .describe("Array of discovered endpoints"),
        count: z.number().describe("Number of endpoints found"),
        path: z.string().describe("The path that was explored"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { path?: string }) => {
      try {
        const path = params.path || "";
        const endpoints = await withTimeout(
          discoveryService.discoverEndpoints(path),
          15000,
          "discover_endpoints(" + path + ")"
        );

        const result = {
          endpoints: endpoints.map((ep: DiscoveredEndpoint) => ({
            name: ep.name,
            path: ep.path,
          })),
          count: endpoints.length,
          path: path || "/",
        };

        const lines = ["Discovered " + result.count + " endpoint(s) at **" + result.path + "**:", ""];
        for (const ep of result.endpoints) {
          lines.push("- `" + ep.path + "` — " + ep.name);
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          structuredContent: result,
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes("Timeout")) {
          logger.warn("Discovery timeout: " + msg);
          return {
            content: [
              {
                type: "text" as const,
                text: "Discovery timed out for this path. The RouterOS device may not support this endpoint or it took too long to respond.",
              },
            ],
            structuredContent: { endpoints: [], count: 0, path: params.path || "/" },
          };
        }
        return handleRouterOSError(error);
      }
    }
  );

  server.registerTool(
    "mikrotik_get_endpoint_schema",
    {
      title: "Get MikroTik Endpoint Schema",
      description:
        "Get the schema (available commands and parameters) for a specific MikroTik API endpoint. " +
        "Returns command list and parameter definitions. May timeout on some endpoints.",
      inputSchema: {
        path: z.string().describe("The path of the endpoint to get the schema for"),
      },
      outputSchema: {
        path: z.string().describe("The endpoint path"),
        commands: z.array(z.string()).describe("Available commands"),
        parameters: z
          .array(
            z.object({
              name: z.string().describe("Parameter name"),
              type: z.string().optional().describe("Parameter type"),
              required: z.boolean().optional().describe("Whether parameter is required"),
            })
          )
          .describe("Available parameters"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { path: string }) => {
      try {
        const schema: EndpointSchema = await withTimeout(
          discoveryService.getEndpointSchema(params.path),
          15000,
          "get_schema(" + params.path + ")"
        );

        const result = {
          path: params.path,
          commands: schema.commands,
          parameters: schema.parameters,
        };

        const lines = [
          "Schema for **" + result.path + "**:",
          "",
          "**Commands:** " + (result.commands.length > 0 ? result.commands.join(", ") : "none"),
          "",
          "**Parameters:**",
        ];
        for (const p of result.parameters) {
          lines.push("- `" + p.name + "`" + (p.type ? " (" + p.type + ")" : "") + (p.required ? " *required*" : ""));
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          structuredContent: result,
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes("Timeout")) {
          logger.warn("Schema timeout: " + msg);
          return {
            content: [
              {
                type: "text" as const,
                text: "Schema retrieval timed out for `" + params.path + "`. " +
                  "Some RouterOS endpoints do not support schema inspection via `/console/inspect`.",
              },
            ],
            structuredContent: { path: params.path, commands: [], parameters: [] },
          };
        }
        return handleRouterOSError(error);
      }
    }
  );
}
