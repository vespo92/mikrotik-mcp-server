import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterOSClient } from "../routeros/client.js";
import { handleRouterOSError } from "../utils/errors.js";
import { formatBytes, toBool, toInt, truncateText } from "../utils/format.js";

export async function registerInterfaceTools(
  server: McpServer,
  client: RouterOSClient
): Promise<void> {
  server.registerTool(
    "mikrotik_list_interfaces",
    {
      title: "List Network Interfaces",
      description:
        "List all network interfaces with their status and statistics",
      inputSchema: {
        type: z.string().optional().describe("Filter by interface type (e.g., 'ether', 'bridge', 'vlan')"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(50)
          .describe("Maximum number of interfaces to return"),
        offset: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe("Number of interfaces to skip"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      outputSchema: {
        total: z.number().describe("Total number of interfaces"),
        count: z.number().describe("Number of interfaces returned"),
        offset: z.number().describe("Offset used in query"),
        interfaces: z
          .array(
            z.object({
              name: z.string(),
              type: z.string(),
              mtu: z.number(),
              macAddress: z.string(),
              running: z.boolean(),
              disabled: z.boolean(),
              rxBytes: z.number(),
              txBytes: z.number(),
              comment: z.string(),
            })
          )
          .describe("Array of interface objects"),
        hasMore: z.boolean().describe("Whether more interfaces are available"),
        nextOffset: z.number().optional().describe("Offset for next page if hasMore is true"),
      },
    },
    async (params) => {
      try {
        const result = await client.execute("/interface/print");

        if (!Array.isArray(result)) {
          return {
            content: [{ type: "text", text: "Error: Unexpected response format from RouterOS" }],
          };
        }

        let interfaces = result;
        if (params.type) {
          interfaces = interfaces.filter(
            (intf: Record<string, unknown>) => String(intf.type || "") === params.type
          );
        }

        const total = interfaces.length;
        const offset = params.offset || 0;
        const limit = params.limit || 50;
        const paginatedInterfaces = interfaces.slice(offset, offset + limit);

        const structuredInterfaces = paginatedInterfaces.map(
          (intf: Record<string, unknown>) => ({
            name: String(intf.name || ""),
            type: String(intf.type || ""),
            mtu: toInt(String(intf["max-packet-size"] ?? "")) || 1500,
            macAddress: String(intf["mac-address"] || "N/A"),
            running: toBool(String(intf.running ?? "")) || false,
            disabled: toBool(String(intf.disabled ?? "")) || false,
            rxBytes: toInt(String(intf["rx-byte"] ?? "")) || 0,
            txBytes: toInt(String(intf["tx-byte"] ?? "")) || 0,
            comment: String(intf.comment || ""),
          })
        );

        const hasMore = offset + limit < total;
        const nextOffset = hasMore ? offset + limit : undefined;

        const markdown = `# Network Interfaces (${paginatedInterfaces.length}/${total})

${params.type ? `**Filter:** type = "${params.type}"` : ""}
${offset > 0 ? `**Offset:** ${offset}` : ""}

| Name | Type | Status | MTU | MAC Address | RX | TX |
|------|------|--------|-----|-------------|----|----|${structuredInterfaces
  .map(
    (intf) =>
      `\n| ${intf.name} | ${intf.type} | ${intf.disabled ? "Disabled" : intf.running ? "Running" : "Down"} | ${intf.mtu} | ${intf.macAddress} | ${formatBytes(intf.rxBytes)} | ${formatBytes(intf.txBytes)} |`
  )
  .join("")}

${hasMore ? `\n**More interfaces available.** Next offset: ${nextOffset}` : ""}`;

        return {
          content: [{ type: "text", text: truncateText(markdown) }],
          structuredContent: {
            total,
            count: paginatedInterfaces.length,
            offset,
            interfaces: structuredInterfaces,
            hasMore,
            nextOffset,
          },
        };
      } catch (error) {
        return handleRouterOSError(error);
      }
    }
  );

  server.registerTool(
    "mikrotik_get_interface",
    {
      title: "Get Interface Details",
      description: "Get detailed information about a specific network interface",
      inputSchema: {
        name: z.string().describe("Name of the interface"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      outputSchema: {
        name: z.string(),
        type: z.string(),
        mtu: z.number(),
        macAddress: z.string(),
        running: z.boolean(),
        disabled: z.boolean(),
        rxBytes: z.number(),
        txBytes: z.number(),
        comment: z.string(),
        id: z.string(),
      },
    },
    async (params) => {
      try {
        const allInterfaces = await client.execute("/interface/print");
        const result = Array.isArray(allInterfaces)
          ? allInterfaces.filter(
              (i: Record<string, unknown>) => String(i.name || "") === params.name
            )
          : [];

        if (!Array.isArray(result) || result.length === 0) {
          return {
            content: [{ type: "text", text: `Interface "${params.name}" not found` }],
          };
        }

        const intf = result[0] as Record<string, unknown>;
        const structuredInterface = {
          id: String(intf[".id"] || ""),
          name: String(intf.name || ""),
          type: String(intf.type || ""),
          mtu: toInt(String(intf["max-packet-size"] ?? "")) || 1500,
          macAddress: String(intf["mac-address"] || "N/A"),
          running: toBool(String(intf.running ?? "")) || false,
          disabled: toBool(String(intf.disabled ?? "")) || false,
          rxBytes: toInt(String(intf["rx-byte"] ?? "")) || 0,
          txBytes: toInt(String(intf["tx-byte"] ?? "")) || 0,
          comment: String(intf.comment || ""),
        };

        const markdown = `# Interface: ${structuredInterface.name}

**Type:** ${structuredInterface.type}
**ID:** \`${structuredInterface.id}\`

## Status
- **Running:** ${structuredInterface.running ? "Yes" : "No"}
- **Disabled:** ${structuredInterface.disabled ? "Yes" : "No"}

## Configuration
- **MTU:** ${structuredInterface.mtu} bytes
- **MAC Address:** \`${structuredInterface.macAddress}\`
- **Comment:** ${structuredInterface.comment || "*(none)*"}

## Statistics
- **RX:** ${formatBytes(structuredInterface.rxBytes)}
- **TX:** ${formatBytes(structuredInterface.txBytes)}`;

        return {
          content: [{ type: "text", text: truncateText(markdown) }],
          structuredContent: structuredInterface,
        };
      } catch (error) {
        return handleRouterOSError(error);
      }
    }
  );

  server.registerTool(
    "mikrotik_configure_interface",
    {
      title: "Configure Interface",
      description: "Update network interface settings",
      inputSchema: {
        id: z.string().describe("Interface ID (.id field)"),
        disabled: z.boolean().optional().describe("Enable or disable the interface"),
        mtu: z.number().int().min(68).max(65535).optional().describe("Maximum transmission unit (68-65535)"),
        comment: z.string().optional().describe("Interface comment/description"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      outputSchema: {
        success: z.boolean(),
        message: z.string(),
      },
    },
    async (params) => {
      try {
        const updateParams: Record<string, string> = { ".id": params.id };
        if (params.disabled !== undefined) {
          updateParams.disabled = params.disabled ? "true" : "false";
        }
        if (params.mtu !== undefined) {
          updateParams["max-packet-size"] = params.mtu.toString();
        }
        if (params.comment !== undefined) {
          updateParams.comment = params.comment;
        }

        await client.write("/interface/set", updateParams);

        const changes = [];
        if (params.disabled !== undefined) changes.push(`disabled: ${params.disabled}`);
        if (params.mtu !== undefined) changes.push(`MTU: ${params.mtu}`);
        if (params.comment !== undefined) changes.push(`comment: "${params.comment}"`);

        const markdown = `# Interface Configuration Updated\n\n**Interface ID:** \`${params.id}\`\n\n## Changes Applied\n${changes.map((c) => `- ${c}`).join("\n")}`;

        return {
          content: [{ type: "text", text: truncateText(markdown) }],
          structuredContent: { success: true, message: `Interface ${params.id} updated successfully` },
        };
      } catch (error) {
        return handleRouterOSError(error);
      }
    }
  );
}
