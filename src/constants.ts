/**
 * Shared constants for MikroTik MCP Server.
 */

/** Maximum response size in characters */
export const CHARACTER_LIMIT = 25000;

/** Default API timeout in milliseconds */
export const DEFAULT_TIMEOUT = 30000;

/** Default pagination limit */
export const DEFAULT_LIMIT = 50;

/** Maximum pagination limit */
export const MAX_LIMIT = 200;

/** Default RouterOS API port */
export const DEFAULT_API_PORT = 8728;

/** Default RouterOS API-SSL port */
export const DEFAULT_API_SSL_PORT = 8729;

/** Discovery cache TTL (24 hours) */
export const DISCOVERY_CACHE_TTL = 86400000;

/** Connection pool health check interval (60 seconds) */
export const HEALTH_CHECK_INTERVAL = 60000;

/** Connection idle timeout (5 minutes) */
export const IDLE_TIMEOUT = 300000;

/** Maximum retry attempts */
export const MAX_RETRIES = 3;

/** Base retry delay in ms (exponential backoff) */
export const RETRY_BASE_DELAY = 1000;

/** Server metadata */
export const SERVER_NAME = "mikrotik-mcp-server";
export const SERVER_VERSION = "3.0.0";
