/**
 * Ethernet port configuration (/interface/ethernet).
 *
 * Configure speed, auto-negotiation, full/half duplex, and comments on
 * physical ports (including SFP+/QSFP+ slots on CRS3xx switches).
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterOSClient } from "../routeros/client.js";
import { handleRouterOSError } from "../utils/errors.js";
import { toBool, truncateText } from "../utils/format.js";

export async function registerEthernetTools(
  server: McpServer,
  client: RouterOSClient
): Promise<void> {
  server.registerTool(
    "mikrotik_list_ethernet_ports",
    {
      title: "List Ethernet Ports",
      description:
        "List all physical ethernet ports with current speed, auto-neg, and link status. Includes SFP+/QSFP+ slots on switch products.",
      inputSchema: {},
      outputSchema: {
        total: z.number(),
        ports: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            defaultName: z.string(),
            speed: z.string(),
            autoNegotiation: z.boolean(),
            fullDuplex: z.boolean(),
            running: z.boolean(),
            disabled: z.boolean(),
            comment: z.string(),
          })
        ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const res = await client.execute("/interface/ethernet/print");
        const ports = (res as Record<string, unknown>[]).map((p) => ({
          id: String(p[".id"] || ""),
          name: String(p.name || ""),
          defaultName: String(p["default-name"] || ""),
          speed: String(p.speed || "auto"),
          autoNegotiation: toBool(p["auto-negotiation"] as string),
          fullDuplex: toBool(p["full-duplex"] as string),
          running: toBool(p.running as string),
          disabled: toBool(p.disabled as string),
          comment: String(p.comment || ""),
        }));
        const md = `# Ethernet Ports (${ports.length})\n\n| Name | Default | Speed | Auto-Neg | Link | Comment |\n|------|---------|-------|----------|------|---------|\n${ports
          .map(
            (p) =>
              `| ${p.name} | ${p.defaultName} | ${p.speed} | ${p.autoNegotiation ? "yes" : "no"} | ${p.disabled ? "disabled" : p.running ? "up" : "down"} | ${p.comment} |`
          )
          .join("\n")}`;
        return {
          content: [{ type: "text" as const, text: truncateText(md) }],
          structuredContent: { total: ports.length, ports },
        };
      } catch (error) {
        return handleRouterOSError(error);
      }
    }
  );

  server.registerTool(
    "mikrotik_configure_ethernet_port",
    {
      title: "Configure Ethernet Port",
      description:
        "Set speed, duplex, auto-negotiation, comment, or enabled state on a physical ethernet port. Destructive: changing speed on an active port will drop link.",
      inputSchema: {
        id: z.string().describe("Port ID (.id). List with mikrotik_list_ethernet_ports."),
        speed: z
          .enum(["10Mbps", "100Mbps", "1Gbps", "2.5Gbps", "5Gbps", "10Gbps", "25Gbps", "40Gbps", "100Gbps"])
          .optional(),
        autoNegotiation: z.boolean().optional(),
        fullDuplex: z.boolean().optional(),
        disabled: z.boolean().optional(),
        comment: z.string().optional(),
      },
      outputSchema: { success: z.boolean() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const payload: Record<string, string> = { ".id": params.id };
        if (params.speed !== undefined) payload.speed = params.speed;
        if (params.autoNegotiation !== undefined) payload["auto-negotiation"] = params.autoNegotiation ? "yes" : "no";
        if (params.fullDuplex !== undefined) payload["full-duplex"] = params.fullDuplex ? "yes" : "no";
        if (params.disabled !== undefined) payload.disabled = params.disabled ? "yes" : "no";
        if (params.comment !== undefined) payload.comment = params.comment;
        await client.write("/interface/ethernet/set", payload);
        const changes = Object.keys(payload).filter((k) => k !== ".id").join(", ");
        return {
          content: [{ type: "text" as const, text: `Updated port ${params.id}: ${changes}` }],
          structuredContent: { success: true },
        };
      } catch (error) {
        return handleRouterOSError(error);
      }
    }
  );
}
