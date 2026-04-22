/**
 * Dead-man's-switch config rollback tools.
 *
 * RouterOS console has a "safe-mode" feature that auto-reverts changes if the
 * session drops — it's not directly available over the API. These tools
 * provide equivalent lockout protection for remote configuration:
 *
 *   1. mikrotik_arm_rollback  — take a binary backup, schedule a restore
 *      + reboot job to fire in N minutes.
 *   2. Make your risky changes (VLAN reshuffle, firewall, etc.).
 *   3. Verify you still have connectivity.
 *   4. mikrotik_disarm_rollback — cancel the scheduled job.
 *
 * If you lose connectivity, the scheduled job fires and the router restores
 * the backup, rebooting into the known-good config.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterOSClient } from "../routeros/client.js";
import { handleRouterOSError } from "../utils/errors.js";

const SCHEDULER_PREFIX = "mcp-rollback-";
const BACKUP_PREFIX = "mcp-rollback-";

function isoToRouterTime(date: Date): { startDate: string; startTime: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const startDate = `${months[date.getMonth()]}/${pad(date.getDate())}/${date.getFullYear()}`;
  const startTime = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return { startDate, startTime };
}

export async function registerRollbackTools(
  server: McpServer,
  client: RouterOSClient
): Promise<void> {
  server.registerTool(
    "mikrotik_arm_rollback",
    {
      title: "Arm Config Rollback (dead-man's switch)",
      description:
        "Take a binary backup and schedule an automatic restore + reboot to fire in N minutes. Use this BEFORE risky changes (VLANs, firewall, bridge reshuffles). If you lose connectivity, the router auto-recovers. Call mikrotik_disarm_rollback once you confirm connectivity after the change.",
      inputSchema: {
        minutes: z
          .number()
          .int()
          .min(1)
          .max(60)
          .default(5)
          .describe("Minutes until automatic rollback fires (1-60)"),
      },
      outputSchema: {
        success: z.boolean(),
        token: z.string().describe("Session token — pass to mikrotik_disarm_rollback"),
        backupName: z.string(),
        schedulerName: z.string(),
        firesAt: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      try {
        const token = Math.floor(Date.now() / 1000).toString();
        const backupName = `${BACKUP_PREFIX}${token}`;
        const schedulerName = `${SCHEDULER_PREFIX}${token}`;

        await client.write("/system/backup/save", { name: backupName, "dont-encrypt": "yes" });

        const fireAt = new Date(Date.now() + params.minutes * 60 * 1000);
        const { startDate, startTime } = isoToRouterTime(fireAt);

        const onEvent = `/system backup load name=${backupName} password=""; /system reboot`;

        await client.write("/system/scheduler/add", {
          name: schedulerName,
          "start-date": startDate,
          "start-time": startTime,
          interval: "0s",
          "on-event": onEvent,
          policy: "ftp,reboot,read,write,policy,test,password,sensitive,romon",
          comment: "MCP dead-man rollback — auto-generated",
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `# Rollback ARMED\n\n**Fires at:** ${fireAt.toISOString()}\n**Backup:** ${backupName}.backup\n**Token:** \`${token}\`\n\nIf you lose connectivity, the router will auto-restore this backup and reboot.\n\nCall **mikrotik_disarm_rollback** with token \`${token}\` once you verify the changes work.`,
            },
          ],
          structuredContent: {
            success: true,
            token,
            backupName: `${backupName}.backup`,
            schedulerName,
            firesAt: fireAt.toISOString(),
          },
        };
      } catch (error) {
        return handleRouterOSError(error);
      }
    }
  );

  server.registerTool(
    "mikrotik_disarm_rollback",
    {
      title: "Disarm Config Rollback",
      description:
        "Cancel a previously armed rollback. Call this AFTER verifying your risky changes work. Optionally deletes the backup file.",
      inputSchema: {
        token: z.string().describe("Token returned by mikrotik_arm_rollback"),
        deleteBackup: z.boolean().default(true).describe("Also delete the backup file from the router"),
      },
      outputSchema: {
        success: z.boolean(),
        schedulerRemoved: z.boolean(),
        backupRemoved: z.boolean(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      const schedulerName = `${SCHEDULER_PREFIX}${params.token}`;
      const backupName = `${BACKUP_PREFIX}${params.token}.backup`;
      let schedulerRemoved = false;
      let backupRemoved = false;

      try {
        const entries = await client.execute("/system/scheduler/print", { ".proplist": ".id,name" });
        const match = (entries as Record<string, unknown>[]).find((e) => e.name === schedulerName);
        if (match) {
          await client.write("/system/scheduler/remove", { ".id": String(match[".id"]) });
          schedulerRemoved = true;
        }
      } catch (error) {
        return handleRouterOSError(error);
      }

      if (params.deleteBackup) {
        try {
          await client.write("/file/remove", { numbers: backupName });
          backupRemoved = true;
        } catch {
          // Backup file may not exist or already removed — non-fatal.
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `# Rollback DISARMED\n\n- Scheduler removed: ${schedulerRemoved ? "yes" : "not found"}\n- Backup removed: ${backupRemoved ? "yes" : "skipped/not found"}`,
          },
        ],
        structuredContent: { success: true, schedulerRemoved, backupRemoved },
      };
    }
  );

  server.registerTool(
    "mikrotik_list_armed_rollbacks",
    {
      title: "List Armed Rollbacks",
      description: "List any MCP-armed rollback scheduler entries currently pending.",
      inputSchema: {},
      outputSchema: {
        total: z.number(),
        rollbacks: z.array(
          z.object({
            token: z.string(),
            schedulerName: z.string(),
            startDate: z.string(),
            startTime: z.string(),
            nextRun: z.string(),
          })
        ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const entries = await client.execute("/system/scheduler/print");
        const rollbacks = (entries as Record<string, unknown>[])
          .filter((e) => String(e.name || "").startsWith(SCHEDULER_PREFIX))
          .map((e) => ({
            token: String(e.name || "").slice(SCHEDULER_PREFIX.length),
            schedulerName: String(e.name || ""),
            startDate: String(e["start-date"] || ""),
            startTime: String(e["start-time"] || ""),
            nextRun: String(e["next-run"] || ""),
          }));
        const md = rollbacks.length
          ? `# Armed Rollbacks (${rollbacks.length})\n\n${rollbacks
              .map((r) => `- Token \`${r.token}\` — fires ${r.startDate} ${r.startTime} (next run: ${r.nextRun})`)
              .join("\n")}`
          : "No armed rollbacks.";
        return {
          content: [{ type: "text" as const, text: md }],
          structuredContent: { total: rollbacks.length, rollbacks },
        };
      } catch (error) {
        return handleRouterOSError(error);
      }
    }
  );
}
