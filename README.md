# @vespo92/mikrotik-mcp-server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![MCP SDK 1.16+](https://img.shields.io/badge/MCP%20SDK-1.16%2B-blue)](https://github.com/modelcontextprotocol/typescript-sdk)

**TypeScript MCP server for MikroTik RouterOS** — manage routers and switches through natural language with Claude or any MCP-compatible client.

Forked from [`ai-solutions-ru/mikrotik-mcp-server`](https://github.com/Ai-Solutions-ru/mikrotik-mcp-server) and extended with:

- **Bridge VLAN filtering tools** for CRS3xx/CRS5xx/CCR switches (hardware-offloaded 802.1Q)
- **Dead-man rollback** — arm a scheduled auto-restore before risky changes to prevent remote lockout
- **Hardened `execute_command`** — hard-deny catastrophic ops, confirm-required for high-risk
- **Ethernet port + VLAN interface tools**
- **HTTP transport** with bearer-token auth — run it as a networked service for remote agents
- **Bun-compatible** — run with `bun` or `node`

```bash
git clone https://github.com/vespo92/mikrotik-mcp-server.git
cd mikrotik-mcp-server && npm install && npm run build
```

---

## 🚀 Why This Server?

| Feature | **This server** | jeff-nasseri/mikrotik-mcp | kevinpez (nested fork) |
|---|---|---|---|
| Language | **TypeScript / Node.js** | Python | Python |
| Dynamic API Discovery | ✅ **Browse full RouterOS API tree** | ❌ | ❌ |
| Structured JSON output (`structuredContent`) | ✅ **Every tool** | ❌ | ❌ |
| Zod output schemas | ✅ **Typed & validated** | ❌ | ❌ |
| MCP safety annotations | ✅ `readOnly/destructive/idempotent` | ❌ | ❌ |
| WireGuard VPN management | ✅ list + add peers | ❌ | ❌ |
| IPsec peer management | ✅ | ❌ | ❌ |
| Configuration backup & export | ✅ binary + script export | ❌ | ❌ |
| Raw command execution (escape hatch) | ✅ `execute_command` | ❌ | ❌ |
| Pagination on all list tools | ✅ limit/offset | partial | partial |
| Smart output truncation | ✅ auto-hint for large results | ❌ | ❌ |
| In-memory caching | ✅ discovery cache | ❌ | ❌ |
| MCP SDK version | **1.16+** (latest) | old | old |
| Install via npx | ✅ zero config | ❌ pip install | ❌ pip install |

---

## ✨ Unique Features

### 1. Dynamic API Discovery (unique in ecosystem)

Browse the **entire RouterOS API tree** without needing to know command paths in advance. The AI can explore unknown router configurations autonomously.

```
→ mikrotik_discover_endpoints(path: "/ip")
  Returns: address, arp, dhcp-client, dhcp-server, dns, firewall, hotspot, ipsec, ...

→ mikrotik_get_endpoint_schema(path: "/ip/firewall/filter")
  Returns: available commands (print, add, remove, set, enable, disable) and parameters
```

This means Claude can discover and interact with **any RouterOS subsystem** — including packages you've installed, containers, advanced routing, hardware-specific features — without the server needing hardcoded knowledge of them.

### 2. Structured Content + Zod Output Schemas

Every tool returns **both** human-readable Markdown **and** machine-readable JSON via `structuredContent`. The JSON is validated against Zod schemas, giving you typed, predictable data structures that work with MCP clients that support structured output.

```typescript
// Example: mikrotik_list_ip_addresses returns
{
  content: [{ type: "text", text: "# IP Addresses\n..." }],   // ← Markdown for AI
  structuredContent: {                                          // ← Typed JSON for clients
    total: 5,
    addresses: [{ id: "*1", address: "192.168.1.1/24", interface: "bridge", ... }]
  }
}
```

### 3. MCP Safety Annotations

Tools are annotated with MCP 2025 safety hints so AI clients can present appropriate warnings:

- `readOnlyHint: true` — safe to call without side effects (list/print operations)
- `destructiveHint: true` — modifies router state (add/remove/reboot)
- `idempotentHint: true` — safe to retry
- `openWorldHint: true` — queries live state from router

The reboot tool additionally requires `confirm: true` parameter as an extra safety gate.

### 4. VPN Management (WireGuard + IPsec)

First MikroTik MCP server with **WireGuard peer management**:
- List all WireGuard peers with traffic stats
- Add new WireGuard peers with endpoint and allowed addresses
- List IPsec peers with profiles
- Graceful handling when WireGuard package isn't installed

### 5. Raw Command Execution

`mikrotik_execute_command` provides a full escape hatch to the RouterOS API — execute **any** RouterOS command with any parameters. This enables AI to handle edge cases, new RouterOS features, or complex operations not covered by specialized tools.

### 6. Configuration Backup & Export

- `mikrotik_create_backup` — binary RouterOS backup (survives factory reset)
- `mikrotik_export_config` — human-readable script export with statistics (line count, command count, size)

---

## 📋 Full Tool Reference

### 🖥 System (2 tools)
| Tool | Description | Annotations |
|---|---|---|
| `mikrotik_system_info` | CPU, RAM, storage, uptime, version, board info | readOnly |
| `mikrotik_system_reboot` | Reboot device (requires `confirm: true`) | destructive |

### 🔌 Interfaces (3 tools)
| Tool | Description |
|---|---|
| `mikrotik_list_interfaces` | List all interfaces with type filter + pagination |
| `mikrotik_get_interface` | Get detailed info for specific interface |
| `mikrotik_configure_interface` | Enable/disable, set MTU, comment |

### 🌐 IP Addresses (3 tools)
| Tool | Description |
|---|---|
| `mikrotik_list_ip_addresses` | List all IP addresses with interface filter + pagination |
| `mikrotik_add_ip_address` | Add IP address to interface |
| `mikrotik_remove_ip_address` | Remove IP address by ID |

### 🔥 Firewall (3 tools)
| Tool | Description |
|---|---|
| `mikrotik_list_firewall_rules` | List filter rules with chain filter + pagination |
| `mikrotik_add_firewall_rule` | Add filter rule with full parameter support |
| `mikrotik_remove_firewall_rule` | Remove rule by ID |

### 📡 DHCP (3 tools)
| Tool | Description |
|---|---|
| `mikrotik_list_dhcp_leases` | List leases with status filter + pagination |
| `mikrotik_add_static_lease` | Assign static IP to MAC address |
| `mikrotik_list_dhcp_servers` | List configured DHCP servers |

### 🔍 DNS (2 tools)
| Tool | Description |
|---|---|
| `mikrotik_list_dns_static` | List static DNS records with pagination |
| `mikrotik_add_dns_record` | Add A/AAAA/CNAME static DNS record |

### 🗺 Routing (3 tools)
| Tool | Description |
|---|---|
| `mikrotik_list_routes` | List all routes with pagination |
| `mikrotik_add_route` | Add static route with distance and routing table |
| `mikrotik_list_nat_rules` | List NAT rules with chain filter + pagination |

### 🔐 VPN (3 tools)
| Tool | Description |
|---|---|
| `mikrotik_list_wireguard_peers` | List WireGuard peers with traffic stats |
| `mikrotik_add_wireguard_peer` | Add WireGuard peer with endpoint |
| `mikrotik_list_ipsec_peers` | List IPsec peers with profiles |

### 🌉 Bridge / VLAN Filtering (9 tools — CRS3xx+)
| Tool | Description |
|---|---|
| `mikrotik_list_bridges` | List bridges with VLAN filtering state |
| `mikrotik_add_bridge` | Create a bridge (enable `vlanFiltering` for 802.1Q) |
| `mikrotik_set_bridge_vlan_filtering` | Toggle VLAN filtering on existing bridge |
| `mikrotik_list_bridge_ports` | List port memberships with PVID |
| `mikrotik_add_bridge_port` | Add port to bridge (access/trunk via `frameTypes`) |
| `mikrotik_remove_bridge_port` | Remove port membership |
| `mikrotik_list_bridge_vlans` | List bridge VLAN table (tagged/untagged lists) |
| `mikrotik_add_bridge_vlan` | Add VLAN entry with tagged/untagged port lists |
| `mikrotik_remove_bridge_vlan` | Remove VLAN table entry |

### 🏷 VLAN Interfaces (3 tools)
| Tool | Description |
|---|---|
| `mikrotik_list_vlans` | List L3 VLAN interfaces |
| `mikrotik_add_vlan` | Create VLAN interface on bridge (for inter-VLAN routing) |
| `mikrotik_remove_vlan` | Remove VLAN interface |

### 🔌 Ethernet Ports (2 tools)
| Tool | Description |
|---|---|
| `mikrotik_list_ethernet_ports` | List physical ports with speed/link status |
| `mikrotik_configure_ethernet_port` | Set speed, auto-neg, duplex, comment |

### 🛟 Rollback Safety (3 tools)
| Tool | Description |
|---|---|
| `mikrotik_arm_rollback` | Take backup + schedule auto-restore in N min (lockout protection) |
| `mikrotik_disarm_rollback` | Cancel armed rollback after verifying changes |
| `mikrotik_list_armed_rollbacks` | List pending rollback scheduler entries |

### 💾 Backup (2 tools)
| Tool | Description |
|---|---|
| `mikrotik_create_backup` | Create binary system backup |
| `mikrotik_export_config` | Export config as text script with statistics |

### ⚡ Execute (1 tool)
| Tool | Description |
|---|---|
| `mikrotik_execute_command` | Execute any RouterOS API command (destructive) |

### 🔭 Discovery (2 tools)
| Tool | Description |
|---|---|
| `mikrotik_discover_endpoints` | Browse RouterOS API tree at any path |
| `mikrotik_get_endpoint_schema` | Get available commands & params for endpoint |

**Total: 47 tools + 4 MCP resources**

---

## 📦 MCP Resources

| Resource URI | Description |
|---|---|
| `routeros://system/info` | Live system info snapshot |
| `routeros://interfaces` | All interface states |
| `routeros://firewall/rules` | Full firewall ruleset |
| `routeros://routing/routes` | All routing table entries |

---

## 🔧 Installation & Setup

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mikrotik": {
      "command": "node",
      "args": ["/absolute/path/to/mikrotik-mcp-server/dist/index.js"],
      "env": {
        "MIKROTIK_HOST": "192.168.88.1",
        "MIKROTIK_USER": "admin",
        "MIKROTIK_PASSWORD": "yourpassword",
        "MIKROTIK_PORT": "8728",
        "MIKROTIK_SECURE": "false"
      }
    }
  }
}
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `MIKROTIK_HOST` | *(required)* | Router IP or hostname |
| `MIKROTIK_USER` | `admin` | API username |
| `MIKROTIK_PASSWORD` | *(required)* | API password |
| `MIKROTIK_PORT` | `8728` | RouterOS API port (8729 for TLS) |
| `MIKROTIK_SECURE` | `false` | Use TLS (requires port 8729) |
| `MIKROTIK_TIMEOUT` | `30000` | Connection timeout in ms |
| `MCP_TRANSPORT` | `stdio` | `stdio` (Claude Desktop) or `http` (network) |
| `MCP_HTTP_HOST` | `0.0.0.0` | HTTP bind address (http transport only) |
| `MCP_HTTP_PORT` | `3000` | HTTP listen port (http transport only) |
| `MIKROTIK_MCP_TOKEN` | *(empty)* | Bearer token for HTTP auth. **Required** when bound to non-loopback. |
| `DISCOVERY_CACHE_TTL` | `86400000` | Discovery cache TTL in ms |

---

## 🌐 Run as a Networked Service

Run the MCP server as a daemon and connect from Claude Code (or any MCP client) remotely. Useful when you want a single Claude Code session to control the router from any machine on your LAN.

### Start the server

```bash
export MIKROTIK_HOST=192.168.88.1
export MIKROTIK_PASSWORD='...'
export MCP_TRANSPORT=http
export MCP_HTTP_HOST=0.0.0.0
export MCP_HTTP_PORT=3000
export MIKROTIK_MCP_TOKEN="$(openssl rand -hex 32)"   # save this — you'll need it
echo "$MIKROTIK_MCP_TOKEN"

# with node
npm run start:http

# or with bun
npm run start:bun:http
```

Health check: `curl http://<host>:3000/healthz` → `{"ok":true,"sessions":0}`

### Connect Claude Code to the networked server

```bash
claude mcp add --transport http mikrotik http://<server-ip>:3000/mcp \
  --header "Authorization: Bearer <MIKROTIK_MCP_TOKEN>"
```

Verify: `claude mcp list` should show `mikrotik: http://.../mcp · Connected`.

### Security notes for network mode

- `MIKROTIK_MCP_TOKEN` is mandatory when binding to `0.0.0.0`. Without it, anyone on the network can reconfigure your router.
- For untrusted networks, terminate TLS in front of the server (nginx/caddy/Traefik) and never expose it to the public internet.
- Rotate the token if you suspect compromise — changing env + restarting invalidates all sessions.

---

## 🥟 Bun Support

The server runs under Bun in addition to Node. Bun is faster to start and has built-in TypeScript — nice for dev.

```bash
# Run compiled output with bun
bun dist/index.js

# Or run TypeScript directly (no build step)
bun run src/index.ts

# HTTP transport under bun
npm run start:bun:http
# or
MCP_TRANSPORT=http bun dist/index.js
```

Verified: `@modelcontextprotocol/sdk` streamable HTTP transport, `node-routeros` (uses `node:net`/`node:tls`), and `express` all work under Bun 1.1+.

### Enable RouterOS API

In RouterOS WebFig or terminal:
```
/ip service enable api
```
For TLS: `/ip service enable api-ssl`

---

## 💬 Example Conversations

**"What's the current state of my router?"**
> Calls `mikrotik_system_info` → Returns device name, RouterOS version, CPU load, RAM usage, uptime

**"Show me all firewall rules that drop traffic"**
> Calls `mikrotik_list_firewall_rules(chain="forward")` → Filters by action=drop

**"Add a static DNS record for myserver.local pointing to 10.0.0.50"**
> Calls `mikrotik_add_dns_record(name="myserver.local", address="10.0.0.50")`

**"List all WireGuard peers and their traffic stats"**
> Calls `mikrotik_list_wireguard_peers()` → Returns peers with RX/TX bytes

**"What API endpoints are available under /container?"**
> Calls `mikrotik_discover_endpoints(path="/container")` → Browses RouterOS container API

**"Export the full router config as a backup script"**
> Calls `mikrotik_export_config()` → Returns full RouterOS export with stats

---

## 🏗 Architecture

```
src/
├── index.ts              # Entry point, env config
├── server.ts             # MCP server + tool/resource registration
├── constants.ts          # Configuration constants
├── routeros/
│   └── client.ts         # RouterOS API client (node-routeros)
├── cache/
│   └── memory.ts         # LRU in-memory cache
├── discovery/
│   └── service.ts        # Dynamic API discovery service
├── tools/
│   ├── system.ts         # System info & reboot
│   ├── interfaces.ts     # Interface management
│   ├── ip-address.ts     # IP address CRUD
│   ├── firewall.ts       # Firewall rules
│   ├── dhcp.ts           # DHCP leases & servers
│   ├── dns.ts            # Static DNS records
│   ├── routing.ts        # Routes & NAT
│   ├── vpn.ts            # WireGuard & IPsec
│   ├── backup.ts         # Backup & export
│   ├── execute.ts        # Raw command execution
│   └── discovery.ts      # API discovery tools
├── resources/
│   ├── system-info.ts    # System resource
│   ├── interfaces.ts     # Interfaces resource
│   ├── firewall.ts       # Firewall resource
│   └── routing.ts        # Routing resource
└── utils/
    ├── format.ts         # Formatting, truncation, pagination
    ├── errors.ts         # RouterOS error handling
    └── logger.ts         # Structured logging
```

---

## 🔒 Security Notes

- All write operations carry `destructiveHint: true` annotation
- Reboot requires explicit `confirm: true` parameter
- `mikrotik_execute_command` has a hard-deny list (reset-configuration, license update, routerboard upgrade, user/active remove) and requires `confirm: true` for high-risk operations (user/service/firewall/reboot/file removal/backup load)
- Credentials are passed via environment variables (never in code)
- TLS support via `MIKROTIK_SECURE=true` + port 8729
- Consider using a read-only RouterOS API user for monitoring-only setups
- **Before risky remote changes, always call `mikrotik_arm_rollback` first** — this takes a binary backup and schedules an auto-restore job. Disarm it after verifying connectivity.

## 🧪 Example: Setting up a CRS326 with VLANs (safely)

```
→ mikrotik_arm_rollback(minutes: 10)            # dead-man switch armed

→ mikrotik_add_bridge(name: "bridge1", vlanFiltering: true, pvid: 1)
→ mikrotik_add_bridge_port(bridge: "bridge1", interface: "sfp-sfpplus1",
                           pvid: 10, frameTypes: "admit-only-untagged-and-priority-tagged")
→ mikrotik_add_bridge_port(bridge: "bridge1", interface: "sfp-sfpplus24",
                           pvid: 1, frameTypes: "admit-only-vlan-tagged")
→ mikrotik_add_bridge_vlan(bridge: "bridge1", vlanIds: "10",
                           tagged: "bridge1,sfp-sfpplus24", untagged: "sfp-sfpplus1")
→ mikrotik_add_vlan(name: "vlan10", vlanId: 10, interface: "bridge1")
→ mikrotik_add_ip_address(address: "10.10.0.1/24", interface: "vlan10")

# verify connectivity from your laptop...

→ mikrotik_disarm_rollback(token: "...")        # lock in the changes
```

---

## 📜 License

MIT — forked from [ai-solutions-ru/mikrotik-mcp-server](https://github.com/Ai-Solutions-ru/mikrotik-mcp-server) © AI Solutions. Fork modifications © Vinnie Esposito.
