import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterOSClient } from "../routeros/client.js";
import { handleRouterOSError } from "../utils/errors.js";
import { toBool, toInt, truncateText } from "../utils/format.js";

export function registerFirewallTools(
  server: McpServer,
  client: RouterOSClient
): void {
  server.registerTool(
    "mikrotik_list_firewall_rules",
    {
      title: "List Firewall Filter Rules",
      description:
        "List firewall filter rules with pagination. Returns rule chain, action, addresses, ports, and traffic counters.",
      inputSchema: {
        chain: z.enum(["input", "forward", "output"]).optional().describe("Filter rules by chain"),
        limit: z.number().int().min(1).max(200).default(50).describe("Number of rules to return"),
        offset: z.number().int().min(0).default(0).describe("Number of rules to skip"),
      },
      outputSchema: {
        total: z.number().describe("Total number of rules"),
        count: z.number().describe("Number of rules in this response"),
        offset: z.number().describe("Current offset"),
        rules: z.array(z.object({
          id: z.string(), chain: z.string(), action: z.string(),
          protocol: z.string().optional(), srcAddress: z.string().optional(),
          dstAddress: z.string().optional(), dstPort: z.string().optional(),
          comment: z.string().optional(), disabled: z.boolean(),
          bytes: z.number(), packets: z.number(),
        })),
        hasMore: z.boolean(), nextOffset: z.number().optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const chain = params.chain as string | undefined;
        const limit = (params.limit as number) ?? 50;
        const offset = (params.offset as number) ?? 0;
        const queryParams: Record<string, string> = {};
        if (chain) queryParams.chain = chain;
        const response = await client.execute(
          "/ip/firewall/filter/print",
          Object.keys(queryParams).length > 0 ? queryParams : undefined
        );
        const total = response.length;
        const rules = response.slice(offset, offset + limit).map((rule) => ({
          id: rule[".id"] as string, chain: rule.chain as string, action: rule.action as string,
          protocol: (rule.protocol as string | undefined) || undefined,
          srcAddress: (rule["src-address"] as string | undefined) || undefined,
          dstAddress: (rule["dst-address"] as string | undefined) || undefined,
          dstPort: (rule["dst-port"] as string | undefined) || undefined,
          comment: (rule.comment as string | undefined) || undefined,
          disabled: toBool(rule.disabled), bytes: toInt(rule.bytes), packets: toInt(rule.packets),
        }));
        const count = rules.length;
        const hasMore = offset + limit < total;
        const nextOffset = hasMore ? offset + limit : undefined;
        let markdown = `**Firewall Filter Rules**${chain ? ` (chain: ${chain})` : ""}\nShowing ${count} of ${total} rules (offset: ${offset})\n\n`;
        for (const rule of rules) {
          markdown += `- **${rule.id}** [${rule.chain}] ${rule.action}`;
          if (rule.protocol) markdown += ` proto:${rule.protocol}`;
          if (rule.srcAddress) markdown += ` src:${rule.srcAddress}`;
          if (rule.dstAddress) markdown += ` dst:${rule.dstAddress}`;
          if (rule.dstPort) markdown += ` port:${rule.dstPort}`;
          if (rule.disabled) markdown += " (disabled)";
          if (rule.comment) markdown += ` — ${rule.comment}`;
          markdown += `\n  bytes: ${rule.bytes}, packets: ${rule.packets}\n`;
        }
        if (hasMore) markdown += `\n_More rules available. Use offset=${nextOffset} to see next page._`;
        return { content: [{ type: "text" as const, text: truncateText(markdown) }], structuredContent: { total, count, offset, rules, hasMore, nextOffset } };
      } catch (error) { return handleRouterOSError(error); }
    }
  );

  server.registerTool(
    "mikrotik_add_firewall_rule",
    {
      title: "Add Firewall Filter Rule",
      description: "Add a new firewall filter rule. Supports chain, action, protocol, addresses, ports, and placement.",
      inputSchema: {
        chain: z.enum(["input", "forward", "output"]).describe("Target chain"),
        action: z.enum(["accept", "drop", "reject", "jump", "log", "passthrough"]).describe("Rule action"),
        protocol: z.string().optional().describe("Protocol (tcp, udp, icmp, etc.)"),
        srcAddress: z.string().optional().describe("Source address/CIDR"),
        dstAddress: z.string().optional().describe("Destination address/CIDR"),
        dstPort: z.string().optional().describe("Destination port(s)"),
        comment: z.string().optional().describe("Rule comment"),
        disabled: z.boolean().default(false).describe("Whether rule starts disabled"),
        placeBefore: z.string().optional().describe("Rule .id to place this rule before"),
      },
      outputSchema: { success: z.boolean(), id: z.string().optional() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      try {
        const payload: Record<string, string> = { chain: params.chain as string, action: params.action as string };
        if (params.protocol) payload.protocol = params.protocol as string;
        if (params.srcAddress) payload["src-address"] = params.srcAddress as string;
        if (params.dstAddress) payload["dst-address"] = params.dstAddress as string;
        if (params.dstPort) payload["dst-port"] = params.dstPort as string;
        if (params.comment) payload.comment = params.comment as string;
        if (params.disabled) payload.disabled = "yes";
        if (params.placeBefore) payload["place-before"] = params.placeBefore as string;
        const response = await client.write("/ip/firewall/filter/add", payload);
        const id = Array.isArray(response) && response.length > 0 ? (response[0]?.ret as string) || "created" : "created";
        return { content: [{ type: "text" as const, text: `Added firewall rule: **${params.chain}** ${params.action} (ID: ${id})` }], structuredContent: { success: true, id } };
      } catch (error) { return handleRouterOSError(error); }
    }
  );

  server.registerTool(
    "mikrotik_remove_firewall_rule",
    {
      title: "Remove Firewall Filter Rule",
      description: "Remove a firewall filter rule by ID.",
      inputSchema: { id: z.string().describe("The .id of the rule to remove") },
      outputSchema: { success: z.boolean(), removedId: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        await client.write("/ip/firewall/filter/remove", { ".id": params.id as string });
        return {
          content: [{ type: "text" as const, text: `Successfully removed firewall rule **${params.id}**` }],
          structuredContent: { success: true, removedId: params.id as string },
        };
      } catch (error) { return handleRouterOSError(error); }
    }
  );

  server.registerTool(
    "mikrotik_list_nat_rules",
    {
      title: "List NAT Rules",
      description: "List NAT (Network Address Translation) rules with pagination.",
      inputSchema: {
        chain: z.enum(["srcnat", "dstnat"]).optional().describe("Filter rules by NAT chain"),
        limit: z.number().int().min(1).max(200).default(50).describe("Number of rules to return"),
        offset: z.number().int().min(0).default(0).describe("Number of rules to skip"),
      },
      outputSchema: {
        total: z.number(), count: z.number(), offset: z.number(),
        rules: z.array(z.object({
          id: z.string(), chain: z.string(), action: z.string(),
          srcAddress: z.string().optional(), dstAddress: z.string().optional(),
          toAddresses: z.string().optional(), toPorts: z.string().optional(),
          protocol: z.string().optional(), comment: z.string().optional(), disabled: z.boolean(),
        })),
        hasMore: z.boolean(), nextOffset: z.number().optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      try {
        const chain = params.chain as string | undefined;
        const limit = (params.limit as number) ?? 50;
        const offset = (params.offset as number) ?? 0;
        const queryParams: Record<string, string> = {};
        if (chain) queryParams.chain = chain;
        const response = await client.execute(
          "/ip/firewall/nat/print",
          Object.keys(queryParams).length > 0 ? queryParams : undefined
        );
        const total = response.length;
        const rules = response.slice(offset, offset + limit).map((rule) => ({
          id: rule[".id"] as string, chain: rule.chain as string, action: rule.action as string,
          srcAddress: (rule["src-address"] as string | undefined) || undefined,
          dstAddress: (rule["dst-address"] as string | undefined) || undefined,
          toAddresses: (rule["to-addresses"] as string | undefined) || undefined,
          toPorts: (rule["to-ports"] as string | undefined) || undefined,
          protocol: (rule.protocol as string | undefined) || undefined,
          comment: (rule.comment as string | undefined) || undefined,
          disabled: toBool(rule.disabled),
        }));
        const count = rules.length;
        const hasMore = offset + limit < total;
        const nextOffset = hasMore ? offset + limit : undefined;
        let markdown = `**NAT Rules**${chain ? ` (chain: ${chain})` : ""}\nShowing ${count} of ${total} rules (offset: ${offset})\n\n`;
        for (const rule of rules) {
          markdown += `- **${rule.id}** [${rule.chain}] ${rule.action}`;
          if (rule.protocol) markdown += ` proto:${rule.protocol}`;
          if (rule.srcAddress) markdown += ` src:${rule.srcAddress}`;
          if (rule.dstAddress) markdown += ` dst:${rule.dstAddress}`;
          if (rule.toAddresses) markdown += ` -> ${rule.toAddresses}`;
          if (rule.toPorts) markdown += `:${rule.toPorts}`;
          if (rule.disabled) markdown += " (disabled)";
          if (rule.comment) markdown += ` — ${rule.comment}`;
          markdown += "\n";
        }
        if (hasMore) markdown += `\n_More rules available. Use offset=${nextOffset} to see next page._`;
        return { content: [{ type: "text" as const, text: truncateText(markdown) }], structuredContent: { total, count, offset, rules, hasMore, nextOffset } };
      } catch (error) { return handleRouterOSError(error); }
    }
  );
}
