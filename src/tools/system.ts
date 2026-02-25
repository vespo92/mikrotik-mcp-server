import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterOSClient } from "../routeros/client.js";
import { handleRouterOSError } from "../utils/errors.js";
import { formatBytes, formatUptime, parseUptime, toInt, truncateText } from "../utils/format.js";

export function registerSystemTools(
  server: McpServer,
  client: RouterOSClient
): void {
  server.registerTool(
    "mikrotik_system_info",
    {
      title: "Get System Info",
      description: "Retrieve system resource information and device identity from RouterOS.",
      inputSchema: {},
      outputSchema: {
        identity: z.string(), version: z.string(), board: z.string(),
        cpu: z.string(), cpuCount: z.number(), cpuLoad: z.number(),
        totalMemory: z.string(), freeMemory: z.string(), usedMemoryPercent: z.number(),
        totalHdd: z.string(), freeHdd: z.string(), uptime: z.string(), architecture: z.string(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (_params) => {
      try {
        const [resourceResult, identityResult] = await Promise.all([
          client.execute("/system/resource/print"),
          client.execute("/system/identity/print"),
        ]);
        const resource = resourceResult[0];
        if (!resource) throw new Error("No system resource data returned");
        const identity = identityResult[0];
        if (!identity) throw new Error("No system identity data returned");
        const totalHddBytes = toInt(resource["total-hdd-space"], 0);
        const freeHddBytes = toInt(resource["free-hdd-space"], 0);
        const totalMemBytes = toInt(resource["total-memory"], 0);
        const freeMemBytes = toInt(resource["free-memory"], 0);
        const usedMemBytes = totalMemBytes - freeMemBytes;
        const usedMemoryPercent = totalMemBytes > 0 ? Math.round((usedMemBytes / totalMemBytes) * 100) : 0;
        const uptimeSeconds = parseUptime((resource.uptime as string) || "0s");
        const outputData = {
          identity: String(identity.name || "Unknown"),
          version: String(resource.version || "Unknown"),
          board: String(resource["board-name"] || "Unknown"),
          cpu: String(resource["cpu"] || "Unknown"),
          cpuCount: toInt(resource["cpu-count"], 1),
          cpuLoad: toInt(resource["cpu-load"], 0),
          totalMemory: formatBytes(totalMemBytes),
          freeMemory: formatBytes(freeMemBytes),
          usedMemoryPercent,
          totalHdd: formatBytes(totalHddBytes),
          freeHdd: formatBytes(freeHddBytes),
          uptime: formatUptime(uptimeSeconds),
          architecture: String(resource.architecture || "Unknown"),
        };
        const md = `# System Information

## Device
- **Name:** ${outputData.identity}
- **Version:** ${outputData.version}
- **Board:** ${outputData.board}
- **Arch:** ${outputData.architecture}

## CPU
- **CPU:** ${outputData.cpu}
- **Cores:** ${outputData.cpuCount}
- **Load:** ${outputData.cpuLoad}%

## Memory
- **Total:** ${outputData.totalMemory}
- **Free:** ${outputData.freeMemory}
- **Used:** ${outputData.usedMemoryPercent}%

## Storage
- **Total:** ${outputData.totalHdd}
- **Free:** ${outputData.freeHdd}

## Uptime: ${outputData.uptime}`;
        return { content: [{ type: "text", text: truncateText(md) }], structuredContent: outputData };
      } catch (error) { return handleRouterOSError(error); }
    }
  );

  server.registerTool(
    "mikrotik_system_reboot",
    {
      title: "System Restart",
      description: "Initiate a system restart on the RouterOS device. Destructive — disconnects all services temporarily. Requires confirm: true.",
      inputSchema: { confirm: z.literal(true) },
      outputSchema: { success: z.boolean(), message: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (params) => {
      try {
        if (params.confirm !== true) {
          return { content: [{ type: "text", text: "Cancelled: confirm must be true" }], isError: true };
        }
        await client.write("/system/reboot", {});
        return {
          content: [{ type: "text", text: "# System restart initiated\n\nRouter will be unavailable for a few minutes." }],
          structuredContent: { success: true, message: "System restart initiated" },
        };
      } catch (error) { return handleRouterOSError(error); }
    }
  );
}
