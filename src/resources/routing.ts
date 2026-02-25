/**
 * MCP Resource: routeros://routing/table
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterOSClient } from "../routeros/client.js";
import { toBool, toInt } from "../utils/format.js";
import { logger } from "../utils/logger.js";

export function registerRoutingResource(server: McpServer, client: RouterOSClient): void {
  server.registerResource(
    "routeros_routing_table",
    "routeros://routing/table",
    {
      description: "MikroTik RouterOS IP routing table",
      mimeType: "application/json",
    },
    async () => {
      try {
        const routes = await client.execute("/ip/route/print");

        const data = routes.map((r) => ({
          id: r[".id"] || "",
          dstAddress: r["dst-address"] || "",
          gateway: r.gateway || "",
          distance: toInt(r.distance),
          routingTable: r["routing-table"] || "main",
          active: toBool(r.active),
          disabled: toBool(r.disabled),
          comment: r.comment || undefined,
        }));

        return {
          contents: [
            {
              uri: "routeros://routing/table",
              mimeType: "application/json",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error("Failed to read routing resource", {
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          contents: [
            {
              uri: "routeros://routing/table",
              mimeType: "text/plain",
              text: `Error reading routing table: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );
}
