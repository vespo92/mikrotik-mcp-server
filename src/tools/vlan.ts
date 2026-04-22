/**
 * VLAN interface tools (/interface/vlan).
 *
 * L3 VLAN interfaces sit on top of a bridge (or physical interface). Used to
 * assign an IP address per VLAN for inter-VLAN routing on the switch.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterOSClient } from "../routeros/client.js";
import { handleRouterOSError } from "../utils/errors.js";
import { toBool, truncateText } from "../utils/format.js";

export async function registerVlanTools(
  server: McpServer,
  client: RouterOSClient
): Promise<void> {
  server.registerTool(
    "mikrotik_list_vlans",
    {
      title: "List VLAN Interfaces",
      description: "List all L3 VLAN interfaces (/interface/vlan).",
      inputSchema: {
        interface: z.string().optional().describe("Filter by parent interface"),
      },
      outputSchema: {
        total: z.number(),
        vlans: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            vlanId: z.number(),
            interface: z.string(),
            mtu: z.number(),
            disabled: z.boolean(),
            running: z.boolean(),
            comment: z.string(),
          })
        ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const res = await client.execute("/interface/vlan/print");
        let vlans = (Array.isArray(res) ? res : []).map((v: Record<string, unknown>) => ({
          id: String(v[".id"] || ""),
          name: String(v.name || ""),
          vlanId: parseInt(String(v["vlan-id"] ?? "0"), 10) || 0,
          interface: String(v.interface || ""),
          mtu: parseInt(String(v.mtu ?? "1500"), 10) || 1500,
          disabled: toBool(v.disabled as string),
          running: toBool(v.running as string),
          comment: String(v.comment || ""),
        }));
        if (params.interface) vlans = vlans.filter((v) => v.interface === params.interface);
        const md = `# VLAN Interfaces (${vlans.length})\n\n| Name | VLAN ID | Parent | MTU | Status |\n|------|---------|--------|-----|--------|\n${vlans
          .map(
            (v) =>
              `| ${v.name} | ${v.vlanId} | ${v.interface} | ${v.mtu} | ${v.disabled ? "disabled" : v.running ? "running" : "down"} |`
          )
          .join("\n")}`;
        return {
          content: [{ type: "text" as const, text: truncateText(md) }],
          structuredContent: { total: vlans.length, vlans },
        };
      } catch (error) {
        return handleRouterOSError(error);
      }
    }
  );

  server.registerTool(
    "mikrotik_add_vlan",
    {
      title: "Add VLAN Interface",
      description:
        "Create an L3 VLAN interface on a parent bridge or physical interface. Use this to assign an IP address per VLAN (inter-VLAN routing).",
      inputSchema: {
        name: z.string().describe("VLAN interface name (e.g., 'vlan10')"),
        vlanId: z.number().int().min(1).max(4094).describe("802.1Q VLAN ID"),
        interface: z
          .string()
          .describe("Parent interface (usually a bridge name like 'bridge1')"),
        mtu: z.number().int().min(68).max(65535).optional(),
        comment: z.string().optional(),
      },
      outputSchema: { success: z.boolean(), id: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      try {
        const payload: Record<string, string> = {
          name: params.name,
          "vlan-id": String(params.vlanId),
          interface: params.interface,
        };
        if (params.mtu !== undefined) payload.mtu = String(params.mtu);
        if (params.comment) payload.comment = params.comment;
        const res = await client.write("/interface/vlan/add", payload);
        const id = Array.isArray(res) && res[0] ? String((res[0] as Record<string, unknown>).ret || "") : "";
        return {
          content: [
            { type: "text" as const, text: `Created VLAN interface **${params.name}** (vid=${params.vlanId}) on ${params.interface}` },
          ],
          structuredContent: { success: true, id },
        };
      } catch (error) {
        return handleRouterOSError(error);
      }
    }
  );

  server.registerTool(
    "mikrotik_remove_vlan",
    {
      title: "Remove VLAN Interface",
      description: "Remove an L3 VLAN interface by ID.",
      inputSchema: { id: z.string() },
      outputSchema: { success: z.boolean() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        await client.write("/interface/vlan/remove", { ".id": params.id });
        return {
          content: [{ type: "text" as const, text: `Removed VLAN interface ${params.id}` }],
          structuredContent: { success: true },
        };
      } catch (error) {
        return handleRouterOSError(error);
      }
    }
  );
}
