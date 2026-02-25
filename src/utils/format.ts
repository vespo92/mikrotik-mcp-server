/**
 * Formatting utilities for MCP responses.
 */

import { CHARACTER_LIMIT } from "../constants.js";

/**
 * Format bytes to human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

/**
 * Format uptime seconds to human-readable string.
 */
export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return parts.join(" ");
}

/**
 * Parse RouterOS uptime string (e.g., "3d12h30m15s") to seconds.
 */
export function parseUptime(uptime: string): number {
  let total = 0;
  const weeks = uptime.match(/(\d+)w/);
  const days = uptime.match(/(\d+)d/);
  const hours = uptime.match(/(\d+)h/);
  const minutes = uptime.match(/(\d+)m/);
  const seconds = uptime.match(/(\d+)s/);
  if (weeks) total += parseInt(weeks[1]) * 604800;
  if (days) total += parseInt(days[1]) * 86400;
  if (hours) total += parseInt(hours[1]) * 3600;
  if (minutes) total += parseInt(minutes[1]) * 60;
  if (seconds) total += parseInt(seconds[1]);
  return total;
}

/**
 * Truncate text to CHARACTER_LIMIT with a notice.
 */
export function truncateText(text: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  const truncated = text.slice(0, CHARACTER_LIMIT - 200);
  return truncated + `\n\n---\n⚠️ Response truncated (${text.length} chars). Use pagination or filters to reduce results.`;
}

/**
 * Build markdown table from array of objects.
 */
export function markdownTable(headers: string[], rows: string[][]): string {
  const headerLine = `| ${headers.join(" | ")} |`;
  const separatorLine = `| ${headers.map(() => "---").join(" | ")} |`;
  const dataLines = rows.map((row) => `| ${row.join(" | ")} |`);
  return [headerLine, separatorLine, ...dataLines].join("\n");
}

/**
 * Clean RouterOS key names: "src-address" -> "srcAddress"
 */
export function camelCase(key: string): string {
  return key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Convert RouterOS "true"/"false" strings to boolean.
 */
export function toBool(value: string | undefined): boolean {
  return value === "true" || value === "yes";
}

/**
 * Parse RouterOS integer string to number.
 */
export function toInt(value: string | undefined, defaultValue = 0): number {
  if (!value) return defaultValue;
  const n = parseInt(value, 10);
  return isNaN(n) ? defaultValue : n;
}
