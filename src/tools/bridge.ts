/**
 * Bridge tools for CRS3xx-style switches using bridge VLAN filtering with
 * hardware offload. Covers: bridges, bridge ports, bridge VLANs.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterOSClient } from "../routeros/client.js";
import { handleRouterOSError } from "../utils/errors.js";
import { toBool, truncateText } from "../utils/format.js";

export async function registerBridgeTools(
  server: McpServer,
  client: RouterOSClient
): Promise<void> {
  server.registerTool(
    "mikrotik_list_bridges",
    {
      title: "List Bridges",
      description:
        "List all bridge interfaces. Includes VLAN filtering state — essential for CRS3xx switch configuration.",
      inputSchema: {},
      outputSchema: {
        total: z.number(),
        bridges: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            vlanFiltering: z.boolean(),
            pvid: z.number(),
            protocolMode: z.string(),
            mtu: z.number(),
            disabled: z.boolean(),
            comment: z.string(),
          })
        ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const res = await client.execute("/interface/bridge/print");
        const bridges = (res as Record<string, unknown>[]).map((b) => ({
          id: String(b[".id"] || ""),
          name: String(b.name || ""),
          vlanFiltering: toBool(b["vlan-filtering"] as string),
          pvid: parseInt(String(b.pvid ?? "1"), 10) || 1,
          protocolMode: String(b["protocol-mode"] || "rstp"),
          mtu: parseInt(String(b.mtu ?? "1500"), 10) || 1500,
          disabled: toBool(b.disabled as string),
          comment: String(b.comment || ""),
        }));
        const md = `# Bridges (${bridges.length})\n\n| Name | VLAN Filter | PVID | STP | MTU | Status |\n|------|-------------|------|-----|-----|--------|\n${bridges
          .map(
            (b) =>
              `| ${b.name} | ${b.vlanFiltering ? "on" : "off"} | ${b.pvid} | ${b.protocolMode} | ${b.mtu} | ${b.disabled ? "disabled" : "enabled"} |`
          )
          .join("\n")}`;
        return {
          content: [{ type: "text" as const, text: truncateText(md) }],
          structuredContent: { total: bridges.length, bridges },
        };
      } catch (error) {
        return handleRouterOSError(error);
      }
    }
  );

  server.registerTool(
    "mikrotik_add_bridge",
    {
      title: "Add Bridge",
      description:
        "Create a bridge interface. For CRS3xx switches, set vlanFiltering=true to enable hardware-offloaded VLAN filtering (recommended).",
      inputSchema: {
        name: z.string().describe("Bridge name (e.g., 'bridge1')"),
        vlanFiltering: z
          .boolean()
          .default(false)
          .describe("Enable bridge VLAN filtering. Required for 802.1Q trunk/access port behavior."),
        pvid: z
          .number()
          .int()
          .min(1)
          .max(4094)
          .default(1)
          .describe("Default VLAN ID for untagged frames on the bridge itself"),
        protocolMode: z
          .enum(["none", "rstp", "stp", "mstp"])
          .default("rstp")
          .describe("Spanning tree protocol mode"),
        comment: z.string().optional(),
      },
      outputSchema: { success: z.boolean(), id: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      try {
        const payload: Record<string, string> = {
          name: params.name,
          "vlan-filtering": params.vlanFiltering ? "yes" : "no",
          pvid: String(params.pvid),
          "protocol-mode": params.protocolMode,
        };
        if (params.comment) payload.comment = params.comment;
        const res = await client.write("/interface/bridge/add", payload);
        const id = Array.isArray(res) && res[0] ? String((res[0] as Record<string, unknown>).ret || "") : "";
        return {
          content: [{ type: "text" as const, text: `Created bridge **${params.name}** (vlan-filtering: ${params.vlanFiltering ? "on" : "off"})` }],
          structuredContent: { success: true, id },
        };
      } catch (error) {
        return handleRouterOSError(error);
      }
    }
  );

  server.registerTool(
    "mikrotik_set_bridge_vlan_filtering",
    {
      title: "Toggle Bridge VLAN Filtering",
      description:
        "Enable or disable bridge VLAN filtering on an existing bridge. WARNING: enabling this reshapes all traffic through the bridge — configure bridge-port PVIDs and bridge-vlan entries first.",
      inputSchema: {
        id: z.string().describe("Bridge ID (.id)"),
        enabled: z.boolean(),
      },
      outputSchema: { success: z.boolean() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        await client.write("/interface/bridge/set", {
          ".id": params.id,
          "vlan-filtering": params.enabled ? "yes" : "no",
        });
        return {
          content: [{ type: "text" as const, text: `Bridge ${params.id} vlan-filtering: ${params.enabled ? "on" : "off"}` }],
          structuredContent: { success: true },
        };
      } catch (error) {
        return handleRouterOSError(error);
      }
    }
  );

  server.registerTool(
    "mikrotik_list_bridge_ports",
    {
      title: "List Bridge Ports",
      description: "List all bridge port memberships with PVID and frame-type policy.",
      inputSchema: {
        bridge: z.string().optional().describe("Filter by bridge name"),
      },
      outputSchema: {
        total: z.number(),
        ports: z.array(
          z.object({
            id: z.string(),
            bridge: z.string(),
            interface: z.string(),
            pvid: z.number(),
            frameTypes: z.string(),
            hw: z.boolean(),
            disabled: z.boolean(),
            comment: z.string(),
          })
        ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const res = await client.execute("/interface/bridge/port/print");
        let ports = (res as Record<string, unknown>[]).map((p) => ({
          id: String(p[".id"] || ""),
          bridge: String(p.bridge || ""),
          interface: String(p.interface || ""),
          pvid: parseInt(String(p.pvid ?? "1"), 10) || 1,
          frameTypes: String(p["frame-types"] || "admit-all"),
          hw: toBool(p.hw as string),
          disabled: toBool(p.disabled as string),
          comment: String(p.comment || ""),
        }));
        if (params.bridge) ports = ports.filter((p) => p.bridge === params.bridge);
        const md = `# Bridge Ports (${ports.length})\n\n| Bridge | Interface | PVID | Frame Types | HW | Status |\n|--------|-----------|------|-------------|----|--------|\n${ports
          .map(
            (p) =>
              `| ${p.bridge} | ${p.interface} | ${p.pvid} | ${p.frameTypes} | ${p.hw ? "yes" : "no"} | ${p.disabled ? "disabled" : "enabled"} |`
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
    "mikrotik_add_bridge_port",
    {
      title: "Add Bridge Port",
      description:
        "Add a physical interface to a bridge as either access or trunk port. PVID = native VLAN for untagged frames; frameTypes controls tagged/untagged admission.",
      inputSchema: {
        bridge: z.string().describe("Bridge name"),
        interface: z.string().describe("Interface name (e.g., 'sfp-sfpplus1')"),
        pvid: z
          .number()
          .int()
          .min(1)
          .max(4094)
          .default(1)
          .describe("Port VLAN ID — untagged frames are classified into this VLAN"),
        frameTypes: z
          .enum(["admit-all", "admit-only-untagged-and-priority-tagged", "admit-only-vlan-tagged"])
          .default("admit-all")
          .describe("admit-only-vlan-tagged = trunk, admit-only-untagged-and-priority-tagged = access"),
        comment: z.string().optional(),
      },
      outputSchema: { success: z.boolean(), id: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      try {
        const payload: Record<string, string> = {
          bridge: params.bridge,
          interface: params.interface,
          pvid: String(params.pvid),
          "frame-types": params.frameTypes,
        };
        if (params.comment) payload.comment = params.comment;
        const res = await client.write("/interface/bridge/port/add", payload);
        const id = Array.isArray(res) && res[0] ? String((res[0] as Record<string, unknown>).ret || "") : "";
        return {
          content: [
            { type: "text" as const, text: `Added ${params.interface} to bridge ${params.bridge} (pvid=${params.pvid}, frame-types=${params.frameTypes})` },
          ],
          structuredContent: { success: true, id },
        };
      } catch (error) {
        return handleRouterOSError(error);
      }
    }
  );

  server.registerTool(
    "mikrotik_remove_bridge_port",
    {
      title: "Remove Bridge Port",
      description: "Remove a bridge port membership by ID.",
      inputSchema: { id: z.string() },
      outputSchema: { success: z.boolean() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        await client.write("/interface/bridge/port/remove", { ".id": params.id });
        return {
          content: [{ type: "text" as const, text: `Removed bridge port ${params.id}` }],
          structuredContent: { success: true },
        };
      } catch (error) {
        return handleRouterOSError(error);
      }
    }
  );

  server.registerTool(
    "mikrotik_list_bridge_vlans",
    {
      title: "List Bridge VLANs",
      description:
        "List bridge VLAN table entries (/interface/bridge/vlan). This is the core of 802.1Q VLAN filtering — each entry defines tagged/untagged port lists per VLAN ID.",
      inputSchema: {
        bridge: z.string().optional(),
      },
      outputSchema: {
        total: z.number(),
        vlans: z.array(
          z.object({
            id: z.string(),
            bridge: z.string(),
            vlanIds: z.string(),
            tagged: z.string(),
            untagged: z.string(),
            currentTagged: z.string(),
            currentUntagged: z.string(),
            disabled: z.boolean(),
          })
        ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const res = await client.execute("/interface/bridge/vlan/print");
        let vlans = (res as Record<string, unknown>[]).map((v) => ({
          id: String(v[".id"] || ""),
          bridge: String(v.bridge || ""),
          vlanIds: String(v["vlan-ids"] || ""),
          tagged: String(v.tagged || ""),
          untagged: String(v.untagged || ""),
          currentTagged: String(v["current-tagged"] || ""),
          currentUntagged: String(v["current-untagged"] || ""),
          disabled: toBool(v.disabled as string),
        }));
        if (params.bridge) vlans = vlans.filter((v) => v.bridge === params.bridge);
        const md = `# Bridge VLANs (${vlans.length})\n\n| Bridge | VLAN IDs | Tagged | Untagged | Status |\n|--------|----------|--------|----------|--------|\n${vlans
          .map(
            (v) =>
              `| ${v.bridge} | ${v.vlanIds} | ${v.tagged || "—"} | ${v.untagged || "—"} | ${v.disabled ? "disabled" : "enabled"} |`
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
    "mikrotik_add_bridge_vlan",
    {
      title: "Add Bridge VLAN",
      description:
        "Add a VLAN entry to the bridge VLAN table. `tagged` = trunk ports that carry this VLAN tagged, `untagged` = access ports where this VLAN is delivered without a tag.",
      inputSchema: {
        bridge: z.string().describe("Bridge name"),
        vlanIds: z.string().describe("VLAN ID or range (e.g., '10' or '10-20' or '10,20,30')"),
        tagged: z
          .string()
          .optional()
          .describe("Comma-separated list of interfaces where VLAN is tagged (e.g., 'sfp-sfpplus1,sfp-sfpplus2')"),
        untagged: z
          .string()
          .optional()
          .describe("Comma-separated list of interfaces where VLAN is untagged (access ports)"),
        comment: z.string().optional(),
      },
      outputSchema: { success: z.boolean(), id: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      try {
        const payload: Record<string, string> = {
          bridge: params.bridge,
          "vlan-ids": params.vlanIds,
        };
        if (params.tagged) payload.tagged = params.tagged;
        if (params.untagged) payload.untagged = params.untagged;
        if (params.comment) payload.comment = params.comment;
        const res = await client.write("/interface/bridge/vlan/add", payload);
        const id = Array.isArray(res) && res[0] ? String((res[0] as Record<string, unknown>).ret || "") : "";
        return {
          content: [
            { type: "text" as const, text: `Added VLAN ${params.vlanIds} to bridge ${params.bridge} (tagged: ${params.tagged || "—"}, untagged: ${params.untagged || "—"})` },
          ],
          structuredContent: { success: true, id },
        };
      } catch (error) {
        return handleRouterOSError(error);
      }
    }
  );

  server.registerTool(
    "mikrotik_remove_bridge_vlan",
    {
      title: "Remove Bridge VLAN",
      description: "Remove a bridge VLAN table entry by ID.",
      inputSchema: { id: z.string() },
      outputSchema: { success: z.boolean() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        await client.write("/interface/bridge/vlan/remove", { ".id": params.id });
        return {
          content: [{ type: "text" as const, text: `Removed bridge VLAN ${params.id}` }],
          structuredContent: { success: true },
        };
      } catch (error) {
        return handleRouterOSError(error);
      }
    }
  );
}
