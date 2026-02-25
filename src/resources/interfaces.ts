/**
 * MCP Resource: routeros://interfaces/status
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterOSClient } from "../routeros/client.js";
import { formatBytes, toBool, toInt } from "../utils/format.js";
import { logger } from "../utils/logger.js";

export function registerInterfacesResource(server: McpServer, client: RouterOSClient): void {
  server.registerResource(
    "routeros_interfaces_status",
    "routeros://interfaces/status",
    {
      description: "MikroTik RouterOS interface status — all interfaces with traffic counters",
      mimeType: "application/json",
    },
    async () => {
      try {
        const interfaces = await client.execute("/interface/print");

        const data = interfaces.map((iface) => ({
          name: iface.name || "",
          type: iface.type || "",
          mtu: toInt(iface["actual-mtu"] || iface.mtu),
          macAddress: iface["mac-address"] || "",
          running: toBool(iface.running),
          disabled: toBool(iface.disabled),
          rxBytes: toInt(iface["rx-byte"]),
          txBytes: toInt(iface["tx-byte"]),
          comment: iface.comment || undefined,
        }));

        return {
          contents: [
            {
              uri: "routeros://interfaces/status",
              mimeType: "application/json",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error("Failed to read interfaces resource", {
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          contents: [
            {
              uri: "routeros://interfaces/status",
              mimeType: "text/plain",
              text: `Error reading interfaces: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );
}
