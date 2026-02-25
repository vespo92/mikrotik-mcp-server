import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterOSClient } from "../routeros/client.js";
import { handleRouterOSError } from "../utils/errors.js";
import { toBool, toInt, truncateText } from "../utils/format.js";

export async function registerRoutingTools(
  server: McpServer,
  client: RouterOSClient
): Promise<void> {
  server.registerTool(
    "mikrotik_list_routes",
    {
      title: "List IP Routes",
      description:
        "List all IP routes configured on the RouterOS device with pagination support. " +
        "Returns destination, gateway, distance, routing table, active/disabled state for each route.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(50)
          .describe("Number of routes to return (1-200, default 50)"),
        offset: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe("Number of routes to skip (default 0)"),
      },
      outputSchema: {
        total: z.number().describe("Total number of routes"),
        count: z.number().describe("Number of routes in this response"),
        offset: z.number().describe("Current offset"),
        routes: z
          .array(
            z.object({
              id: z.string().describe("Route ID"),
              dstAddress: z.string().describe("Destination address/CIDR"),
              gateway: z.string().describe("Gateway address"),
              distance: z.number().describe("Route distance/metric"),
              routingTable: z.string().describe("Routing table name"),
              scope: z.string().describe("Route scope"),
              active: z.boolean().describe("Whether route is active"),
              disabled: z.boolean().describe("Whether route is disabled"),
              comment: z.string().describe("Route comment"),
            })
          )
          .describe("Array of route objects"),
        hasMore: z.boolean().describe("Whether more routes are available"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { limit?: number; offset?: number }) => {
      try {
        const limit = params.limit ?? 50;
        const offset = params.offset ?? 0;

        const response = await client.execute("/ip/route/print");

        const total = response.length;
        const paginatedRoutes = response.slice(offset, offset + limit);

        const routes = paginatedRoutes.map(
          (route: Record<string, unknown>) => ({
            id: String(route[".id"] || ""),
            dstAddress: String(route["dst-address"] || "0.0.0.0/0"),
            gateway: String(route.gateway || ""),
            distance: toInt(route.distance as string, 1),
            routingTable: String(route["routing-table"] || "main"),
            scope: String(route.scope || "30"),
            active: toBool(route.active as string),
            disabled: toBool(route.disabled as string),
            comment: String(route.comment || ""),
          })
        );

        const hasMore = offset + limit < total;
        const result = { total, count: routes.length, offset, routes, hasMore };

        const markdown = ["Found " + result.count + " route(s) (total: " + result.total + "):", ""].concat(
          routes.map(
            (r) =>
              "- **" + r.dstAddress + "** via **" + r.gateway + "** (distance: " + r.distance + ")" +
              (!r.active ? " (inactive)" : "") +
              (r.disabled ? " (disabled)" : "") +
              (r.comment ? " - " + r.comment : "")
          )
        ).join("\n");

        return {
          content: [{ type: "text" as const, text: truncateText(markdown) }],
          structuredContent: result,
        };
      } catch (error) {
        return handleRouterOSError(error);
      }
    }
  );

  server.registerTool(
    "mikrotik_add_route",
    {
      title: "Add IP Route",
      description:
        "Add a new static IP route to RouterOS with optional distance and routing table. " +
        "Returns the created route ID.",
      inputSchema: {
        dstAddress: z
          .string()
          .describe("Destination address (CIDR notation, e.g., 192.168.100.0/24)"),
        gateway: z.string().describe("Gateway IP address"),
        distance: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Route distance/metric (default: 1)"),
        routingTable: z
          .string()
          .default("main")
          .describe("Routing table name (default: main)"),
        comment: z
          .string()
          .optional()
          .describe("Optional comment for the route"),
      },
      outputSchema: {
        success: z.boolean().describe("Whether the operation succeeded"),
        id: z.string().describe("Created route ID"),
        dstAddress: z.string().describe("Destination address"),
        gateway: z.string().describe("Gateway address"),
        distance: z.number().describe("Route distance"),
        routingTable: z.string().describe("Routing table"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: {
      dstAddress: string;
      gateway: string;
      distance?: number;
      routingTable?: string;
      comment?: string;
    }) => {
      try {
        const payload: Record<string, string> = {
          "dst-address": params.dstAddress,
          gateway: params.gateway,
        };

        if (params.distance !== undefined) payload.distance = params.distance.toString();
        if (params.routingTable) payload["routing-table"] = params.routingTable;
        if (params.comment) payload.comment = params.comment;

        const response = await client.write("/ip/route/add", payload);

        const result = {
          success: true,
          id: String(response),
          dstAddress: params.dstAddress,
          gateway: params.gateway,
          distance: params.distance || 1,
          routingTable: params.routingTable || "main",
        };

        return {
          content: [
            {
              type: "text" as const,
              text: "Successfully added route **" + params.dstAddress + "** via **" + params.gateway + "** (distance: " + result.distance + ") (ID: " + result.id + ")",
            },
          ],
          structuredContent: result,
        };
      } catch (error) {
        return handleRouterOSError(error);
      }
    }
  );

  server.registerTool(
    "mikrotik_remove_route",
    {
      title: "Remove IP Route",
      description:
        "Remove a static IP route from RouterOS by its ID. " +
        "Use mikrotik_list_routes to find the route ID first.",
      inputSchema: {
        id: z.string().describe("The .id of the route to remove"),
      },
      outputSchema: {
        success: z.boolean().describe("Whether the operation succeeded"),
        removedId: z.string().describe("The removed route ID"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { id: string }) => {
      try {
        await client.write("/ip/route/remove", { ".id": params.id });

        const result = { success: true, removedId: params.id };

        return {
          content: [
            {
              type: "text" as const,
              text: "Successfully removed route **" + params.id + "**",
            },
          ],
          structuredContent: result,
        };
      } catch (error) {
        return handleRouterOSError(error);
      }
    }
  );
}
