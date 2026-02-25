import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterOSClient } from "../routeros/client.js";
import { handleRouterOSError } from "../utils/errors.js";
import { toBool, truncateText } from "../utils/format.js";

export async function registerDnsTools(
  server: McpServer,
  client: RouterOSClient
): Promise<void> {
  server.registerTool(
    "mikrotik_list_dns_static",
    {
      title: "List DNS Static Records",
      description:
        "List all static DNS records configured on the RouterOS device with pagination support. " +
        "Returns record name, address, type, TTL, disabled state, and comment for each entry.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(50)
          .describe("Number of records to return (1-200, default 50)"),
        offset: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe("Number of records to skip (default 0)"),
      },
      outputSchema: {
        total: z.number().describe("Total number of DNS static records"),
        count: z.number().describe("Number of records in this response"),
        offset: z.number().describe("Current offset"),
        records: z
          .array(
            z.object({
              id: z.string().describe("Record ID"),
              name: z.string().describe("DNS name"),
              address: z.string().describe("IP address or CNAME target"),
              type: z.string().describe("Record type (A, AAAA, CNAME)"),
              ttl: z.string().describe("Time to live"),
              disabled: z.boolean().describe("Whether record is disabled"),
              comment: z.string().describe("Record comment"),
            })
          )
          .describe("Array of DNS static records"),
        hasMore: z.boolean().describe("Whether more records are available"),
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

        const response = await client.execute("/ip/dns/static/print");

        const total = response.length;
        const paginatedRecords = response.slice(offset, offset + limit);

        const records = paginatedRecords.map(
          (record: Record<string, unknown>) => ({
            id: String(record[".id"] || ""),
            name: String(record.name || ""),
            address: String(record.address || ""),
            type: String(record.type || "A"),
            ttl: record.ttl ? String(record.ttl) : "auto",
            disabled: toBool(record.disabled as string),
            comment: String(record.comment || ""),
          })
        );

        const hasMore = offset + limit < total;
        const result = { total, count: records.length, offset, records, hasMore };

        const markdown = ["Found " + result.count + " DNS static record(s) (total: " + result.total + "):", ""].concat(
          records.map(
            (r) =>
              "- **" + r.name + "** -> " + r.address + " (" + r.type + ")" + (r.disabled ? " (disabled)" : "") + (r.comment ? " - " + r.comment : "")
          )
        ).join("\n");

        return {
          content: [{ type: "text" as const, text: truncateText(markdown) }],
          structuredContent: result,
        };
      } catch (error) {
        return handleRouterOSError(error);
      }
    }
  );

  server.registerTool(
    "mikrotik_add_dns_record",
    {
      title: "Add DNS Static Record",
      description:
        "Add a new static DNS record to RouterOS. Creates A, AAAA, or CNAME records " +
        "with optional TTL and comment. Returns the created record ID.",
      inputSchema: {
        name: z.string().describe("DNS name (fully qualified domain name)"),
        address: z.string().describe("IP address to resolve to"),
        type: z
          .enum(["A", "AAAA", "CNAME"])
          .default("A")
          .describe("DNS record type (A, AAAA, or CNAME)"),
        ttl: z
          .string()
          .optional()
          .describe("Time to live (e.g., '3600', 'auto')"),
        comment: z
          .string()
          .optional()
          .describe("Optional comment for the record"),
      },
      outputSchema: {
        success: z.boolean().describe("Whether the operation succeeded"),
        id: z.string().describe("Created record ID"),
        name: z.string().describe("DNS name"),
        address: z.string().describe("IP address"),
        type: z.string().describe("Record type"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: {
      name: string;
      address: string;
      type?: "A" | "AAAA" | "CNAME";
      ttl?: string;
      comment?: string;
    }) => {
      try {
        const payload: Record<string, string> = {
          name: params.name,
          address: params.address,
          type: params.type || "A",
        };

        if (params.ttl) payload.ttl = params.ttl;
        if (params.comment) payload.comment = params.comment;

        const response = await client.write("/ip/dns/static/add", payload);

        const result = {
          success: true,
          id: String(response),
          name: params.name,
          address: params.address,
          type: params.type || "A",
        };

        return {
          content: [
            {
              type: "text" as const,
              text: "Successfully added DNS record **" + params.name + "** -> **" + params.address + "** (" + result.type + ") (ID: " + result.id + ")",
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
    "mikrotik_remove_dns_record",
    {
      title: "Remove DNS Static Record",
      description:
        "Remove a static DNS record from RouterOS by its ID. " +
        "Use mikrotik_list_dns_static to find the record ID first.",
      inputSchema: {
        id: z.string().describe("The .id of the DNS record to remove"),
      },
      outputSchema: {
        success: z.boolean().describe("Whether the operation succeeded"),
        removedId: z.string().describe("The removed record ID"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { id: string }) => {
      try {
        await client.write("/ip/dns/static/remove", { ".id": params.id });

        const result = { success: true, removedId: params.id };

        return {
          content: [
            {
              type: "text" as const,
              text: "Successfully removed DNS record **" + params.id + "**",
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
