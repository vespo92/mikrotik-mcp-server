import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterOSClient } from "../routeros/client.js";
import { handleRouterOSError } from "../utils/errors.js";

/**
 * Denylist of catastrophic commands — always blocked, no override.
 * These either brick the router, wipe config irrecoverably, or disable remote
 * access with no recovery path.
 */
const HARD_DENY: RegExp[] = [
  /^\/system\/reset-configuration\b/,
  /^\/system\/license\/(?:update|renew)\b/,
  /^\/system\/routerboard\/(?:upgrade|settings\/set)\b/,
  /^\/system\/package\/(?:downgrade|uninstall)\b/,
  /^\/user\/active\/remove\b/,
];

/**
 * High-risk commands — require confirm: true to execute. Typical lockout risks:
 * modifying the admin user, disabling API service, removing firewall rules, etc.
 */
const CONFIRM_REQUIRED: RegExp[] = [
  /^\/user\/(?:add|set|remove|disable)\b/,
  /^\/ip\/service\/(?:set|disable|remove)\b/,
  /^\/system\/reboot\b/,
  /^\/system\/shutdown\b/,
  /^\/file\/remove\b/,
  /^\/ip\/firewall\/filter\/remove\b/,
  /^\/ip\/firewall\/nat\/remove\b/,
  /^\/interface\/bridge\/remove\b/,
  /^\/interface\/(?:ethernet\/)?switch\/reset\b/,
  /^\/system\/backup\/load\b/,
];

function isReadOnly(command: string): boolean {
  return /\/(?:print|getall|export|monitor)\s*$/.test(command) || command.endsWith("/print");
}

export async function registerExecuteTools(server: McpServer, client: RouterOSClient): Promise<void> {
  server.registerTool(
    "mikrotik_execute_command",
    {
      title: "Execute RouterOS Command",
      description:
        "Execute arbitrary RouterOS API commands. Destructive operations require confirm:true. Catastrophic commands (reset-configuration, etc.) are always blocked — use the dedicated tools instead. Prefer specialized tools over this escape hatch when they exist.",
      inputSchema: {
        command: z
          .string()
          .describe("RouterOS API command path (e.g., '/ip/address/print', '/interface/bridge/port/add')"),
        params: z.record(z.string(), z.string()).optional().describe("Parameters as key-value pairs"),
        confirm: z
          .boolean()
          .default(false)
          .describe("Required for high-risk commands (user/service/firewall/reboot/etc.)"),
      },
      outputSchema: {
        success: z.boolean(),
        command: z.string(),
        parameters: z.record(z.string(), z.string()),
        resultCount: z.number(),
        results: z.array(z.record(z.string(), z.unknown())),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (params: { command: string; params?: Record<string, string>; confirm?: boolean }) => {
      try {
        if (!params.command.startsWith("/")) {
          return {
            content: [{ type: "text" as const, text: "Error: Command must start with '/' (e.g., '/ip/address/print')" }],
            isError: true,
          };
        }

        const normalized = params.command.trim();

        for (const pattern of HARD_DENY) {
          if (pattern.test(normalized)) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Blocked: \`${normalized}\` is on the hard-deny list (would be catastrophic or unrecoverable). Use a dedicated tool or run it manually on the device console.`,
                },
              ],
              isError: true,
            };
          }
        }

        const needsConfirm = !isReadOnly(normalized) && CONFIRM_REQUIRED.some((p) => p.test(normalized));
        if (needsConfirm && !params.confirm) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Confirm required: \`${normalized}\` can cause lockout or data loss. Re-run with confirm: true after reviewing.`,
              },
            ],
            isError: true,
          };
        }

        const results = await client.execute(normalized, params.params || {});
        const resultArray: Record<string, unknown>[] = Array.isArray(results)
          ? results
          : typeof results === "object"
          ? [results as Record<string, unknown>]
          : [{ result: results }];

        const structured = {
          success: true,
          command: normalized,
          parameters: params.params || {},
          resultCount: resultArray.length,
          results: resultArray,
        };

        let md = "**Command:** `" + normalized + "`\n\n";
        if (params.params && Object.keys(params.params).length > 0) {
          md += "**Parameters:**\n";
          md += Object.entries(params.params).map(([k, v]) => "- " + k + ": `" + v + "`").join("\n") + "\n\n";
        }
        md += "**Results:** " + resultArray.length + " item(s)\n\n";
        if (resultArray.length === 0) {
          md += "No results returned.";
        } else if (resultArray.length <= 10) {
          md += "```json\n" + JSON.stringify(resultArray, null, 2) + "\n```";
        } else {
          md +=
            "Showing first 10 of " +
            resultArray.length +
            " results:\n\n```json\n" +
            JSON.stringify(resultArray.slice(0, 10), null, 2) +
            "\n```\n\n... and " +
            (resultArray.length - 10) +
            " more items.";
        }

        return { content: [{ type: "text" as const, text: md }], structuredContent: structured };
      } catch (error) {
        return handleRouterOSError(error);
      }
    }
  );
}
