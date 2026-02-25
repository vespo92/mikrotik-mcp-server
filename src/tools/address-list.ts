import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterOSClient } from "../routeros/client.js";
import { handleRouterOSError } from "../utils/errors.js";
import { toBool, truncateText } from "../utils/format.js";

export function registerAddressListTools(
  server: McpServer,
  client: RouterOSClient
): void {
  server.registerTool(
    "mikrotik_list_address_lists",
    {
      title: "List Firewall Address Lists",
      description:
        "List all firewall address list entries on the RouterOS device with optional filtering by list name. " +
        "Returns address, list name, creation info, and timeout. " +
        "Useful for viewing IP address groups used in firewall rules.",
      inputSchema: {
        list: z
          .string()
          .optional()
          .describe("Filter by address list name (exact match)"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(50)
          .describe("Number of entries to return (1-200, default 50)"),
        offset: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe("Number of entries to skip (default 0)"),
      },
      outputSchema: {
        total: z.number().describe("Total number of matching entries"),
        count: z.number().describe("Number of entries in this response"),
        offset: z.number().describe("Current offset"),
        entries: z
          .array(
            z.object({
              id: z.string().describe("Entry ID"),
              list: z.string().describe("Address list name"),
              address: z.string().describe("IP address or range"),
              comment: z.string().describe("Entry comment"),
              disabled: z.boolean().describe("Whether entry is disabled"),
              dynamic: z.boolean().describe("Whether entry is dynamic"),
              creationTime: z.string().describe("When the entry was created"),
              timeout: z.string().describe("Entry timeout (if dynamic)"),
            })
          )
          .describe("Array of address list entry objects"),
        hasMore: z.boolean().describe("Whether more entries are available"),
        listNames: z
          .array(z.string())
          .describe("Unique list names found in results"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { list?: string; limit?: number; offset?: number }) => {
      try {
        const limit = params.limit ?? 50;
        const offset = params.offset ?? 0;

        const response = await client.execute("/ip/firewall/address-list/print");

        let filtered = response;
        if (params.list) {
          filtered = response.filter(
            (entry: Record<string, unknown>) =>
              String(entry.list || "") === params.list
          );
        }

        const total = filtered.length;
        const paginated = filtered.slice(offset, offset + limit);

        const entries = paginated.map((entry: Record<string, unknown>) => ({
          id: String(entry[".id"] || ""),
          list: String(entry.list || ""),
          address: String(entry.address || ""),
          comment: String(entry.comment || ""),
          disabled: toBool(entry.disabled as string),
          dynamic: toBool(entry.dynamic as string),
          creationTime: String(entry["creation-time"] || ""),
          timeout: String(entry.timeout || ""),
        }));

        const listNames = [...new Set(entries.map((e) => e.list))].sort();
        const hasMore = offset + limit < total;

        const result = { total, count: entries.length, offset, entries, hasMore, listNames };

        const lines = [
          "Found " + result.count + " address list entries" +
            (params.list ? " in list **" + params.list + "**" : "") +
            " (total: " + result.total + "):",
          "",
        ];
        for (const e of entries) {
          lines.push(
            "- [" + e.list + "] **" + e.address + "**" +
              (e.comment ? " — " + e.comment : "") +
              (e.disabled ? " (disabled)" : "") +
              (e.dynamic ? " (dynamic)" : "")
          );
        }
        if (hasMore) {
          lines.push("", "_More entries available. Use offset=" + (offset + limit) + " to see next page._");
        }

        return {
          content: [{ type: "text" as const, text: truncateText(lines.join("\n")) }],
          structuredContent: result,
        };
      } catch (error) {
        return handleRouterOSError(error);
      }
    }
  );
}
