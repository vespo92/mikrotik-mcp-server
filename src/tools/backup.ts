import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterOSClient } from "../routeros/client.js";
import { handleRouterOSError } from "../utils/errors.js";

export async function registerBackupTools(server: McpServer, client: RouterOSClient): Promise<void> {
  server.registerTool("mikrotik_create_backup", {
    title: "Create System Backup",
    description: "Create a backup file of the RouterOS configuration (system backup, not export). The backup file is saved on the router's filesystem.",
    inputSchema: {
      name: z.string().optional().describe("Backup filename (without .backup extension, auto-generated if not provided)"),
    },
    outputSchema: {
      success: z.boolean().describe("Whether the backup was created"),
      message: z.string().describe("Status message"),
      filename: z.string().describe("Backup filename on the router"),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }, async (params: { name?: string }) => {
    try {
      const payload: Record<string, string> = {};
      if (params.name) payload.name = params.name;
      await client.write("/system/backup/save", payload);
      const backupName = params.name || "backup";
      const result = { success: true, message: "Backup created successfully as '" + backupName + ".backup'", filename: backupName + ".backup" };
      return {
        content: [{ type: "text" as const, text: "Successfully created system backup **" + result.filename + "** on the RouterOS device." }],
        structuredContent: result,
      };
    } catch (error) { return handleRouterOSError(error); }
  });

  server.registerTool("mikrotik_export_config", {
    title: "Export Configuration",
    description: "Export the entire RouterOS configuration as a text script (export format, not binary backup). Returns the full configuration text with line statistics.",
    inputSchema: {},
    outputSchema: {
      success: z.boolean().describe("Whether the export succeeded"),
      config: z.string().describe("Full configuration text"),
      stats: z.object({
        totalLines: z.number().describe("Total non-empty lines"),
        comments: z.number().describe("Comment lines count"),
        commands: z.number().describe("Command lines count"),
        characterCount: z.number().describe("Total character count"),
      }).describe("Configuration statistics"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async () => {
    try {
      const tmpFile = "mcp-export-" + Date.now();
      await client.write("/export", { file: tmpFile });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      let configText = "";
      let offset = 0;
      const chunkSize = 4096;
      let hasMore = true;
      while (hasMore) {
        const chunk = await client.execute("/file/read", { file: tmpFile + ".rsc", "chunk-size": String(chunkSize), offset: String(offset) });
        if (Array.isArray(chunk) && chunk.length > 0 && chunk[0].data) {
          configText += chunk[0].data;
          offset += chunkSize;
          if (String(chunk[0].data).length < chunkSize) hasMore = false;
        } else { hasMore = false; }
      }
      try { await client.execute("/file/remove", { numbers: tmpFile + ".rsc" }); } catch { /* ignore cleanup errors */ }
      configText = configText.replace(/\r\n/g, "\n");
      const lines = configText.split("\n").filter((line) => line.trim());
      const commentLines = lines.filter((line) => line.trim().startsWith("#"));
      const commandLines = lines.filter((line) => line.trim() && !line.trim().startsWith("#"));
      const result = { success: true, config: configText, stats: { totalLines: lines.length, comments: commentLines.length, commands: commandLines.length, characterCount: configText.length } };
      const md = "Successfully exported RouterOS configuration:\n\n**Statistics:**\n- Total lines: " + result.stats.totalLines + "\n- Commands: " + result.stats.commands + "\n- Comments: " + result.stats.comments + "\n- Size: " + (result.stats.characterCount / 1024).toFixed(2) + " KB";
      return { content: [{ type: "text" as const, text: md }], structuredContent: result };
    } catch (error) { return handleRouterOSError(error); }
  });
}
