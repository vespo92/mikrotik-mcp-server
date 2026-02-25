import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterOSClient } from "../routeros/client.js";
import { handleRouterOSError } from "../utils/errors.js";
import { toBool, toInt, truncateText } from "../utils/format.js";
import { logger } from "../utils/logger.js";

function isWireGuardUnavailable(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes("no such command") || msg.includes("timeout") || msg.includes("not installed") || msg.includes("unknown command");
}

export async function registerVpnTools(server: McpServer, client: RouterOSClient): Promise<void> {
  server.registerTool("mikrotik_list_wireguard_peers", {
    title: "List WireGuard Peers",
    description: "List all WireGuard peer configurations on the RouterOS device with pagination support. Requires the WireGuard package to be installed on the router.",
    inputSchema: {
      limit: z.number().int().min(1).max(200).default(50).describe("Number of peers to return (1-200, default 50)"),
      offset: z.number().int().min(0).default(0).describe("Number of peers to skip (default 0)"),
    },
    outputSchema: {
      total: z.number().describe("Total number of WireGuard peers"),
      count: z.number().describe("Number of peers in this response"),
      offset: z.number().describe("Current offset"),
      peers: z.array(z.object({
        id: z.string(), interface: z.string(), publicKey: z.string(),
        endpoint: z.string(), allowedAddress: z.string(), lastHandshake: z.string(),
        rx: z.number(), tx: z.number(), disabled: z.boolean(),
      })).describe("Array of WireGuard peer objects"),
      hasMore: z.boolean().describe("Whether more peers are available"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (params: { limit?: number; offset?: number }) => {
    try {
      const limit = params.limit ?? 50;
      const offset = params.offset ?? 0;
      const response = await client.execute("/interface/wireguard/peers/print");
      const total = response.length;
      const peers = response.slice(offset, offset + limit).map((peer: Record<string, unknown>) => ({
        id: String(peer[".id"] || ""), interface: String(peer.interface || ""),
        publicKey: String(peer["public-key"] || "").substring(0, 20) + "...",
        endpoint: String(peer.endpoint || "not set"), allowedAddress: String(peer["allowed-address"] || "not set"),
        lastHandshake: String(peer["last-handshake"] || "never"),
        rx: toInt(peer.rx as string, 0), tx: toInt(peer.tx as string, 0), disabled: toBool(peer.disabled as string),
      }));
      const hasMore = offset + limit < total;
      const result = { total, count: peers.length, offset, peers, hasMore };
      const lines = ["Found " + result.count + " WireGuard peer(s) (total: " + result.total + "):", ""];
      for (const p of peers) { lines.push("- **" + p.interface + "**: " + p.publicKey + " on " + p.endpoint + (p.disabled ? " (disabled)" : "")); }
      return { content: [{ type: "text" as const, text: truncateText(lines.join("\n")) }], structuredContent: result };
    } catch (error) {
      if (isWireGuardUnavailable(error)) {
        logger.warn("WireGuard package not available on this router");
        return { content: [{ type: "text" as const, text: "WireGuard is not available on this router. The WireGuard package may not be installed." }], structuredContent: { total: 0, count: 0, offset: 0, peers: [], hasMore: false } };
      }
      return handleRouterOSError(error);
    }
  });

  server.registerTool("mikrotik_add_wireguard_peer", {
    title: "Add WireGuard Peer",
    description: "Add a new WireGuard peer configuration to RouterOS with optional endpoint. Requires the WireGuard package to be installed.",
    inputSchema: {
      interface: z.string().describe("WireGuard interface name (e.g., 'wg0')"),
      publicKey: z.string().describe("Peer public key (base64 format)"),
      allowedAddress: z.string().describe("Allowed address (CIDR, e.g., 10.0.0.2/32)"),
      endpointAddress: z.string().optional().describe("Peer endpoint IP address"),
      endpointPort: z.number().int().min(1).max(65535).optional().describe("Peer endpoint UDP port"),
      comment: z.string().optional().describe("Optional comment for the peer"),
    },
    outputSchema: {
      success: z.boolean(), id: z.string(), interface: z.string(),
      publicKey: z.string(), endpoint: z.string(), allowedAddress: z.string(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }, async (params: { interface: string; publicKey: string; allowedAddress: string; endpointAddress?: string; endpointPort?: number; comment?: string }) => {
    try {
      const payload: Record<string, string> = { interface: params.interface, "public-key": params.publicKey, "allowed-address": params.allowedAddress };
      if (params.endpointAddress) payload.endpoint = params.endpointAddress + ":" + (params.endpointPort || 51820);
      if (params.comment) payload.comment = params.comment;
      const response = await client.write("/interface/wireguard/peers/add", payload);
      const endpoint = params.endpointAddress ? params.endpointAddress + ":" + (params.endpointPort || 51820) : "dynamic";
      const result = { success: true, id: String(response), interface: params.interface, publicKey: params.publicKey.substring(0, 20) + "...", endpoint, allowedAddress: params.allowedAddress };
      return { content: [{ type: "text" as const, text: "Successfully added WireGuard peer on **" + params.interface + "** (ID: " + result.id + ")" }], structuredContent: result };
    } catch (error) {
      if (isWireGuardUnavailable(error)) {
        logger.warn("WireGuard package not available");
        return { content: [{ type: "text" as const, text: "WireGuard is not available on this router. Install the WireGuard package first." }], isError: true };
      }
      return handleRouterOSError(error);
    }
  });

  server.registerTool("mikrotik_list_ipsec_peers", {
    title: "List IPsec Peers",
    description: "List all IPsec peer configurations on the RouterOS device with pagination support. Returns peer name, address, profile, and disabled state.",
    inputSchema: {
      limit: z.number().int().min(1).max(200).default(50).describe("Number of peers to return (1-200, default 50)"),
      offset: z.number().int().min(0).default(0).describe("Number of peers to skip (default 0)"),
    },
    outputSchema: {
      total: z.number(), count: z.number(), offset: z.number(),
      peers: z.array(z.object({ id: z.string(), name: z.string(), address: z.string(), profile: z.string(), disabled: z.boolean() })),
      hasMore: z.boolean(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (params: { limit?: number; offset?: number }) => {
    try {
      const limit = params.limit ?? 50;
      const offset = params.offset ?? 0;
      const response = await client.execute("/ip/ipsec/peer/print");
      const total = response.length;
      const peers = response.slice(offset, offset + limit).map((peer: Record<string, unknown>) => ({
        id: String(peer[".id"] || ""), name: String(peer.name || ""),
        address: String(peer.address || "not set"), profile: String(peer.profile || "default"),
        disabled: toBool(peer.disabled as string),
      }));
      const hasMore = offset + limit < total;
      const result = { total, count: peers.length, offset, peers, hasMore };
      const lines = ["Found " + result.count + " IPsec peer(s) (total: " + result.total + "):", ""];
      for (const p of peers) { lines.push("- **" + p.name + "** (" + p.address + ")" + (p.disabled ? " (disabled)" : "") + " Profile: " + p.profile); }
      return { content: [{ type: "text" as const, text: truncateText(lines.join("\n")) }], structuredContent: result };
    } catch (error) { return handleRouterOSError(error); }
  });
}
