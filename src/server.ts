/**
 * MikroTik MCP Server — tool and resource registration.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RouterOSClient } from "./routeros/client.js";
import { MemoryCache } from "./cache/memory.js";
import { DiscoveryService } from "./discovery/service.js";
import { logger } from "./utils/logger.js";
import { SERVER_NAME, SERVER_VERSION, DISCOVERY_CACHE_TTL } from "./constants.js";
import type { RouterOSConfig } from "./types.js";

// Tool registrations
import { registerSystemTools } from "./tools/system.js";
import { registerInterfaceTools } from "./tools/interfaces.js";
import { registerIpAddressTools } from "./tools/ip-address.js";
import { registerFirewallTools } from "./tools/firewall.js";
import { registerDhcpTools } from "./tools/dhcp.js";
import { registerDnsTools } from "./tools/dns.js";
import { registerRoutingTools } from "./tools/routing.js";
import { registerVpnTools } from "./tools/vpn.js";
import { registerBackupTools } from "./tools/backup.js";
import { registerExecuteTools } from "./tools/execute.js";
import { registerDiscoveryTools } from "./tools/discovery.js";
import { registerAddressListTools } from "./tools/address-list.js";
import { registerBridgeTools } from "./tools/bridge.js";
import { registerVlanTools } from "./tools/vlan.js";
import { registerEthernetTools } from "./tools/ethernet.js";
import { registerRollbackTools } from "./tools/rollback.js";

// Resource registrations
import { registerSystemResource } from "./resources/system-info.js";
import { registerInterfacesResource } from "./resources/interfaces.js";
import { registerFirewallResource } from "./resources/firewall.js";
import { registerRoutingResource } from "./resources/routing.js";

export interface ServerComponents {
  server: McpServer;
  client: RouterOSClient;
  cache: MemoryCache;
  discovery: DiscoveryService;
}

/**
 * Create and configure the MCP server with all tools and resources.
 */
export function createServer(config: RouterOSConfig): ServerComponents {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  const client = new RouterOSClient({
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password,
    secure: config.secure,
    timeout: config.timeout,
  });

  const cache = new MemoryCache(500);
  const cacheTtl = parseInt(process.env.DISCOVERY_CACHE_TTL || String(DISCOVERY_CACHE_TTL));
  const discovery = new DiscoveryService(client, cache, cacheTtl);

  // Register all tools
  logger.info("Registering tools...");
  registerSystemTools(server, client);
  registerInterfaceTools(server, client);
  registerIpAddressTools(server, client);
  registerFirewallTools(server, client);
  registerDhcpTools(server, client);
  registerDnsTools(server, client);
  registerRoutingTools(server, client);
  registerVpnTools(server, client);
  registerBackupTools(server, client);
  registerExecuteTools(server, client);
  registerDiscoveryTools(server, discovery);
  registerAddressListTools(server, client);
  registerBridgeTools(server, client);
  registerVlanTools(server, client);
  registerEthernetTools(server, client);
  registerRollbackTools(server, client);
  logger.info("Tools registered: 47");

  // Register resources
  logger.info("Registering resources...");
  registerSystemResource(server, client);
  registerInterfacesResource(server, client);
  registerFirewallResource(server, client);
  registerRoutingResource(server, client);
  logger.info("Resources registered: 4");

  return { server, client, cache, discovery };
}
