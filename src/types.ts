/**
 * TypeScript interfaces for MikroTik MCP Server.
 */

/** RouterOS connection configuration */
export interface RouterOSConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  secure: boolean;
  timeout: number;
}

/** RouterOS API response item */
export interface RouterOSItem {
  ".id": string;
  [key: string]: string | undefined;
}

/** Pagination parameters */
export interface PaginationParams {
  limit: number;
  offset: number;
}

/** Paginated response */
export interface PaginatedResponse<T> {
  total: number;
  count: number;
  offset: number;
  items: T[];
  hasMore: boolean;
  nextOffset?: number;
}

/** Log levels */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** Discovery cache entry */
export interface DiscoveryCacheEntry {
  data: unknown;
  timestamp: number;
  ttl: number;
}

/** Tool result with both text and structured content */
export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}
