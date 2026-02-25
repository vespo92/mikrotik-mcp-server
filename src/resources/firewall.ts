/**
 * MCP Resource: routeros://firewall/rules
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterOSClient } from "../routeros/client.js";
import { toBool, toInt } from "../utils/format.js";
import { logger } from "../utils/logger.js";

export function registerFirewallResource(server: McpServer, client: RouterOSClient): void {
  server.registerResource(
    "routeros_firewall_rules",
    "routeros://firewall/rules",
    {
      description: "MikroTik RouterOS firewall filter rules",
      mimeType: "application/json",
    },
    async () => {
      try {
        const rules = await client.execute("/ip/firewall/filter/print");

        const data = rules.map((r) => ({
          id: r[".id"] || "",
          chain: r.chain || "",
          action: r.action || "",
          protocol: r.protocol || undefined,
          srcAddress: r["src-address"] || undefined,
          dstAddress: r["dst-address"] || undefined,
          dstPort: r["dst-port"] || undefined,
          comment: r.comment || undefined,
          disabled: toBool(r.disabled),
          bytes: toInt(r.bytes),
          packets: toInt(r.packets),
        }));

        return {
          contents: [
            {
              uri: "routeros://firewall/rules",
              mimeType: "application/json",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error("Failed to read firewall resource", {
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          contents: [
            {
              uri: "routeros://firewall/rules",
              mimeType: "text/plain",
              text: `Error reading firewall rules: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );
}
