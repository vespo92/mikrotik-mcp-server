import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterOSClient } from "../routeros/client.js";
import { handleRouterOSError } from "../utils/errors.js";
import { toBool, truncateText } from "../utils/format.js";

export async function registerIpAddressTools(
  server: McpServer,
  client: RouterOSClient
): Promise<void> {
  server.registerTool(
    "mikrotik_list_ip_addresses",
    {
      title: "List IP Addresses",
      description:
        "List all IP addresses configured on the RouterOS device with pagination support",
      inputSchema: {
        interface: z.string().optional().describe("Filter by interface name"),
        limit: z.number().int().min(1).max(200).default(50).describe("Number of addresses to return (1-200, default 50)"),
        offset: z.number().int().min(0).default(0).describe("Number of addresses to skip (default 0)"),
      },
      outputSchema: {
        total: z.number().describe("Total number of matching addresses"),
        count: z.number().describe("Number of addresses in this response"),
        offset: z.number().describe("Current offset"),
        addresses: z.array(z.object({
          id: z.string(),
          address: z.string(),
          network: z.string(),
          interface: z.string(),
          disabled: z.boolean(),
          comment: z.string(),
        })).describe("Array of IP address objects"),
        hasMore: z.boolean().describe("Whether more addresses are available"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: { interface?: string; limit?: number; offset?: number }) => {
      try {
        const limit = params.limit ?? 50;
        const offset = params.offset ?? 0;
        const response = await client.execute("/ip/address/print");
        let addresses = response;
        if (params.interface) {
          addresses = addresses.filter(
            (addr: Record<string, unknown>) => addr.interface === params.interface
          );
        }
        const total = addresses.length;
        const paginatedAddresses = addresses.slice(offset, offset + limit);
        const result = {
          total,
          count: paginatedAddresses.length,
          offset,
          addresses: paginatedAddresses.map((addr: Record<string, unknown>) => ({
            id: String(addr[".id"] || ""),
            address: String(addr.address || ""),
            network: String(addr.network || ""),
            interface: String(addr.interface || ""),
            disabled: toBool(addr.disabled as string),
            comment: String(addr.comment || ""),
          })),
          hasMore: offset + limit < total,
        };
        return {
          content: [{ type: "text" as const, text: `Found ${result.count} IP address(es) (total: ${result.total}):\n\n${result.addresses.map((a) => `- **${a.address}** on ${a.interface}${a.disabled ? " (disabled)" : ""}${a.comment ? ` - ${a.comment}` : ""}`).join("\n")}` }],
          structuredContent: result,
        };
      } catch (error) { return handleRouterOSError(error); }
    }
  );

  server.registerTool(
    "mikrotik_add_ip_address",
    {
      title: "Add IP Address",
      description: "Add a new IP address to an interface on RouterOS",
      inputSchema: {
        address: z.string().describe('IP address with CIDR notation (e.g., "192.168.1.1/24")'),
        interface: z.string().describe("Interface name"),
        disabled: z.boolean().default(false).describe("Whether the address is disabled"),
        comment: z.string().optional().describe("Optional comment"),
      },
      outputSchema: { success: z.boolean(), id: z.string().optional() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (params: { address: string; interface: string; disabled?: boolean; comment?: string }) => {
      try {
        const payload: Record<string, string> = { address: params.address, interface: params.interface };
        if (params.disabled !== undefined) payload.disabled = params.disabled ? "yes" : "no";
        if (params.comment) payload.comment = params.comment;
        const response = await client.write("/ip/address/add", payload);
        return {
          content: [{ type: "text" as const, text: `Successfully added IP address **${params.address}** to interface **${params.interface}**` }],
          structuredContent: { success: true, id: String(response || "") },
        };
      } catch (error) { return handleRouterOSError(error); }
    }
  );

  server.registerTool(
    "mikrotik_remove_ip_address",
    {
      title: "Remove IP Address",
      description: "Remove an IP address from RouterOS",
      inputSchema: { id: z.string().describe("IP address ID to remove") },
      outputSchema: { success: z.boolean(), message: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params: { id: string }) => {
      try {
        await client.write("/ip/address/remove", { ".id": params.id });
        return {
          content: [{ type: "text" as const, text: `Successfully removed IP address (ID: ${params.id})` }],
          structuredContent: { success: true, message: `IP address with ID ${params.id} has been removed` },
        };
      } catch (error) { return handleRouterOSError(error); }
    }
  );
}
