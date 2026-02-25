/**
 * MCP Resource: routeros://system/info
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterOSClient } from "../routeros/client.js";
import { formatBytes, formatUptime, parseUptime, toInt } from "../utils/format.js";
import { logger } from "../utils/logger.js";

export function registerSystemResource(server: McpServer, client: RouterOSClient): void {
  server.registerResource(
    "routeros_system_info",
    "routeros://system/info",
    {
      description: "MikroTik RouterOS system information including identity, version, CPU, memory, and uptime",
      mimeType: "application/json",
    },
    async () => {
      try {
        const [resources, identity] = await Promise.all([
          client.execute("/system/resource/print"),
          client.execute("/system/identity/print"),
        ]);

        const r = resources[0] || {};
        const name = identity[0]?.name || "unknown";
        const totalMem = toInt(r["total-memory"]);
        const freeMem = toInt(r["free-memory"]);
        const uptimeSec = parseUptime(r.uptime || "0s");

        const data = {
          identity: name,
          version: r.version || "unknown",
          board: r["board-name"] || "unknown",
          architecture: r["architecture-name"] || "unknown",
          cpu: r["cpu"] || "unknown",
          cpuCount: toInt(r["cpu-count"], 1),
          cpuLoad: toInt(r["cpu-load"]),
          totalMemory: totalMem,
          freeMemory: freeMem,
          usedMemoryPercent: totalMem > 0 ? Math.round(((totalMem - freeMem) / totalMem) * 100) : 0,
          uptime: formatUptime(uptimeSec),
          uptimeSeconds: uptimeSec,
        };

        return {
          contents: [
            {
              uri: "routeros://system/info",
              mimeType: "application/json",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error("Failed to read system resource", {
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          contents: [
            {
              uri: "routeros://system/info",
              mimeType: "text/plain",
              text: `Error reading system info: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );
}
