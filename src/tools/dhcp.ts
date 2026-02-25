import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterOSClient } from "../routeros/client.js";
import { handleRouterOSError } from "../utils/errors.js";
import { toBool, truncateText } from "../utils/format.js";

export async function registerDhcpTools(
  server: McpServer,
  client: RouterOSClient
): Promise<void> {
  server.registerTool(
    "mikrotik_list_dhcp_leases",
    {
      title: "List DHCP Leases",
      description:
        "List all DHCP leases on the RouterOS device with optional filtering and pagination",
      inputSchema: {
        status: z
          .enum(["bound", "waiting", "offered"])
          .optional()
          .describe("Filter by lease status"),
        limit: z
          .number().int().min(1).max(200).default(50)
          .describe("Number of leases to return (1-200, default 50)"),
        offset: z
          .number().int().min(0).default(0)
          .describe("Number of leases to skip (default 0)"),
      },
      outputSchema: {
        total: z.number().describe("Total number of leases matching the filter"),
        count: z.number().describe("Number of leases in this page"),
        offset: z.number().describe("Offset used for pagination"),
        leases: z.array(
          z.object({
            id: z.string().describe("Lease ID"),
            address: z.string().describe("IP address assigned"),
            macAddress: z.string().describe("MAC address"),
            hostName: z.string().describe("Hostname of the client"),
            server: z.string().describe("DHCP server name"),
            status: z.string().describe("Lease status"),
            expiresAfter: z.string().describe("Time until lease expires"),
            comment: z.string().describe("Comment"),
          })
        ).describe("List of DHCP leases"),
        hasMore: z.boolean().describe("Whether there are more leases available"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: {
      status?: "bound" | "waiting" | "offered";
      limit?: number;
      offset?: number;
    }) => {
      try {
        const limit = params.limit ?? 50;
        const offset = params.offset ?? 0;

        const response = await client.execute("/ip/dhcp-server/lease/print");

        let leases = response;
        if (params.status) {
          leases = leases.filter(
            (lease: Record<string, unknown>) => lease.status === params.status
          );
        }

        const total = leases.length;
        const paginatedLeases = leases.slice(offset, offset + limit);

        const result = {
          total,
          count: paginatedLeases.length,
          offset,
          leases: paginatedLeases.map((lease: Record<string, unknown>) => ({
            id: String(lease[".id"] ?? ""),
            address: String(lease.address ?? ""),
            macAddress: String(lease["mac-address"] ?? ""),
            hostName: String(lease["host-name"] ?? ""),
            server: String(lease.server ?? ""),
            status: String(lease.status ?? ""),
            expiresAfter: String(lease["expires-after"] ?? ""),
            comment: String(lease.comment ?? ""),
          })),
          hasMore: offset + limit < total,
        };

        return {
          content: [
            {
              type: "text" as const,
              text: `Found ${result.count} DHCP lease(es) (total: ${result.total}):\n\n${result.leases.map((l) => `- **${l.address}** (MAC: ${l.macAddress}, Status: ${l.status})${l.hostName ? ` - ${l.hostName}` : ""}${l.comment ? ` (${l.comment})` : ""}`).join("\n")}`,
            },
          ],
          structuredContent: result,
        };
      } catch (error) {
        return handleRouterOSError(error);
      }
    }
  );

  server.registerTool(
    "mikrotik_add_static_lease",
    {
      title: "Add Static DHCP Lease",
      description:
        "Add a static DHCP lease to assign a fixed IP address to a MAC address",
      inputSchema: {
        address: z.string().describe("IP address to assign"),
        macAddress: z
          .string()
          .describe('MAC address (e.g., "00:11:22:33:44:55")'),
        server: z
          .string()
          .default("all")
          .describe("DHCP server name (default: all)"),
        comment: z.string().optional().describe("Optional comment"),
      },
      outputSchema: {
        success: z.boolean().describe("Whether the lease was added successfully"),
        id: z.string().optional().describe("ID of the created lease"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: {
      address: string;
      macAddress: string;
      server?: string;
      comment?: string;
    }) => {
      try {
        const payload: Record<string, string> = {
          address: params.address,
          "mac-address": params.macAddress,
          server: params.server ?? "all",
        };

        if (params.comment) {
          payload.comment = params.comment;
        }

        const response = await client.write(
          "/ip/dhcp-server/lease/add",
          payload
        );

        const result = {
          success: true,
          id: String(response ?? ""),
        };

        return {
          content: [
            {
              type: "text" as const,
              text: `Successfully added static DHCP lease: **${params.macAddress}** -> **${params.address}** (ID: ${response})`,
            },
          ],
          structuredContent: result,
        };
      } catch (error) {
        return handleRouterOSError(error);
      }
    }
  );

  server.registerTool(
    "mikrotik_list_dhcp_servers",
    {
      title: "List DHCP Servers",
      description:
        "List all DHCP servers configured on the RouterOS device with pagination support",
      inputSchema: {
        limit: z
          .number().int().min(1).max(200).default(50)
          .describe("Number of servers to return (1-200, default 50)"),
        offset: z
          .number().int().min(0).default(0)
          .describe("Number of servers to skip (default 0)"),
      },
      outputSchema: {
        total: z.number().describe("Total number of DHCP servers"),
        count: z.number().describe("Number of servers in this page"),
        offset: z.number().describe("Offset used for pagination"),
        servers: z.array(
          z.object({
            id: z.string().describe("Server ID"),
            name: z.string().describe("Server name"),
            interface: z.string().describe("Interface the server listens on"),
            addressPool: z.string().describe("Address pool name"),
            leaseTime: z.string().describe("Default lease time"),
            disabled: z.boolean().describe("Whether the server is disabled"),
          })
        ).describe("List of DHCP servers"),
        hasMore: z.boolean().describe("Whether there are more servers available"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { limit?: number; offset?: number }) => {
      try {
        const limit = params.limit ?? 50;
        const offset = params.offset ?? 0;

        const response = await client.execute("/ip/dhcp-server/print");

        const total = response.length;
        const paginatedServers = response.slice(offset, offset + limit);

        const result = {
          total,
          count: paginatedServers.length,
          offset,
          servers: paginatedServers.map((srv: Record<string, unknown>) => ({
            id: String(srv[".id"] ?? ""),
            name: String(srv.name ?? ""),
            interface: String(srv.interface ?? ""),
            addressPool: String(srv["address-pool"] ?? ""),
            leaseTime: String(srv["lease-time"] ?? ""),
            disabled: toBool(String(srv.disabled ?? "")),
          })),
          hasMore: offset + limit < total,
        };

        return {
          content: [
            {
              type: "text" as const,
              text: `Found ${result.count} DHCP server(s) (total: ${result.total}):\n\n${result.servers.map((s) => `- **${s.name}** on ${s.interface}${s.disabled ? " (disabled)" : ""} - Pool: ${s.addressPool}, Lease: ${s.leaseTime}`).join("\n")}`,
            },
          ],
          structuredContent: result,
        };
      } catch (error) {
        return handleRouterOSError(error);
      }
    }
  );
}
