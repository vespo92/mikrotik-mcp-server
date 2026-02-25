import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterOSClient } from "../routeros/client.js";
import { handleRouterOSError } from "../utils/errors.js";

export async function registerExecuteTools(server: McpServer, client: RouterOSClient): Promise<void> {
  server.registerTool("mikrotik_execute_command", {
    title: "Execute RouterOS Command",
    description: "Execute arbitrary RouterOS API commands. WARNING: This is a raw command execution tool with full access to RouterOS API. Use with caution as it can make destructive changes to your router configuration. Always verify commands before execution.",
    inputSchema: {
      command: z.string().describe("RouterOS API command path (e.g., '/ip/address/print', '/interface/print', '/system/identity/print')"),
      params: z.record(z.string(), z.string()).optional().describe("Optional parameters as key-value pairs (e.g., {'numbers': '*', 'details': 'all'})"),
    },
    outputSchema: {
      success: z.boolean().describe("Whether the command executed successfully"),
      command: z.string().describe("The executed command"),
      parameters: z.record(z.string(), z.string()).describe("Parameters used"),
      resultCount: z.number().describe("Number of result items"),
      results: z.array(z.record(z.string(), z.unknown())).describe("Command results"),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }, async (params: { command: string; params?: Record<string, string> }) => {
    try {
      if (!params.command.startsWith("/")) {
        return { content: [{ type: "text" as const, text: "Error: Command must start with '/' (e.g., '/ip/address/print')" }], isError: true };
      }
      const results = await client.execute(params.command, params.params || {});
      const resultArray: Record<string, unknown>[] = Array.isArray(results) ? results : typeof results === "object" ? [results as Record<string, unknown>] : [{ result: results }];
      const result = { success: true, command: params.command, parameters: params.params || {}, resultCount: resultArray.length, results: resultArray };
      let md = "**Command:** `" + params.command + "`\n\n";
      if (params.params && Object.keys(params.params).length > 0) {
        md += "**Parameters:**\n";
        md += Object.entries(params.params).map(([k, v]) => "- " + k + ": `" + v + "`").join("\n") + "\n\n";
      }
      md += "**Results:** " + resultArray.length + " item(s)\n\n";
      if (resultArray.length === 0) { md += "No results returned."; }
      else if (resultArray.length <= 10) { md += "```json\n" + JSON.stringify(resultArray, null, 2) + "\n```"; }
      else { md += "Showing first 10 of " + resultArray.length + " results:\n\n```json\n" + JSON.stringify(resultArray.slice(0, 10), null, 2) + "\n```\n\n... and " + (resultArray.length - 10) + " more items."; }
      return { content: [{ type: "text" as const, text: md }], structuredContent: result };
    } catch (error) { return handleRouterOSError(error); }
  });
}
