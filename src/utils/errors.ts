/**
 * Error handling utilities for RouterOS operations.
 */

import { logger } from "./logger.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** RouterOS-specific error class */
export class RouterOSError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly category?: string
  ) {
    super(message);
    this.name = "RouterOSError";
  }
}

/** Connection error */
export class ConnectionError extends RouterOSError {
  constructor(message: string, public readonly host?: string) {
    super(message, "CONNECTION_ERROR", "connection");
    this.name = "ConnectionError";
  }
}

/** Authentication error */
export class AuthError extends RouterOSError {
  constructor(message: string) {
    super(message, "AUTH_ERROR", "authentication");
    this.name = "AuthError";
  }
}

/** Timeout error */
export class TimeoutError extends RouterOSError {
  constructor(message: string) {
    super(message, "TIMEOUT_ERROR", "timeout");
    this.name = "TimeoutError";
  }
}

/**
 * Convert any error into an actionable MCP tool error response.
 */
export function handleRouterOSError(error: unknown): CallToolResult {
  let message: string;

  if (error instanceof AuthError) {
    message = `Authentication failed: ${error.message}. Check MIKROTIK_USER and MIKROTIK_PASSWORD environment variables.`;
  } else if (error instanceof ConnectionError) {
    message =
      `Connection failed${error.host ? ` to ${error.host}` : ""}: ${error.message}. ` +
      `Verify MIKROTIK_HOST and MIKROTIK_PORT, ensure the API service is enabled on the router.`;
  } else if (error instanceof TimeoutError) {
    message = `Operation timed out: ${error.message}. Try increasing MIKROTIK_TIMEOUT or simplify the query.`;
  } else if (error instanceof RouterOSError) {
    message = `RouterOS error: ${error.message}`;
  } else if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("cannot log in") || msg.includes("invalid user")) {
      message = `Authentication failed: ${error.message}. Check credentials.`;
    } else if (msg.includes("econnrefused") || msg.includes("econnreset")) {
      message = `Connection refused. Ensure RouterOS API service is enabled and the port is correct.`;
    } else if (msg.includes("etimedout") || msg.includes("timeout")) {
      message = `Connection timed out. Verify the router is reachable and the API port is open.`;
    } else if (msg.includes("no such command") || msg.includes("no such item")) {
      message = `RouterOS command not found: ${error.message}. This feature may not be available on your RouterOS version.`;
    } else {
      message = `Error: ${error.message}`;
    }
  } else {
    message = `Unexpected error: ${String(error)}`;
  }

  logger.error("Tool error", { error: message });

  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}
