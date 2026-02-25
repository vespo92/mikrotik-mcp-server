import { MemoryCache } from "../cache/memory.js";
import { RouterOSClient } from "../routeros/client.js";
import { logger } from "../utils/logger.js";

export interface DiscoveredEndpoint {
  name: string;
  type: string;
  path: string;
}

export interface EndpointParameter {
  name: string;
  type: string;
  required: boolean;
}

export interface EndpointSchema {
  path: string;
  commands: string[];
  parameters: EndpointParameter[];
}

export class DiscoveryService {
  constructor(
    private client: RouterOSClient,
    private cache: MemoryCache,
    private ttl: number
  ) {}

  async discoverEndpoints(path?: string): Promise<DiscoveredEndpoint[]> {
    const normalizedPath = path || "";
    const cacheKey = `discovery:endpoints:${normalizedPath}`;
    const cached = this.cache.get<DiscoveredEndpoint[]>(cacheKey);
    if (cached !== undefined) {
      logger.debug(`Cache hit for endpoints at path: ${normalizedPath}`);
      return cached;
    }
    logger.debug(`Discovering endpoints at path: ${normalizedPath}`);
    try {
      const result = await this.client.execute("/console/inspect", { request: "child", path: normalizedPath });
      const endpoints: DiscoveredEndpoint[] = [];
      if (Array.isArray(result)) {
        for (const item of result) {
          if (item.name) {
            endpoints.push({ name: item.name, type: item.type || "unknown", path: normalizedPath ? `${normalizedPath}/${item.name}` : item.name });
          }
        }
      }
      this.cache.set(cacheKey, endpoints, this.ttl);
      logger.debug(`Discovered ${endpoints.length} endpoints at path: ${normalizedPath}`);
      return endpoints;
    } catch (error) {
      logger.error(`Failed to discover endpoints at path ${normalizedPath}:`, { error } as Record<string, unknown>);
      throw error;
    }
  }

  async getEndpointSchema(path: string): Promise<EndpointSchema> {
    const cacheKey = `discovery:schema:${path}`;
    const cached = this.cache.get<EndpointSchema>(cacheKey);
    if (cached !== undefined) {
      logger.debug(`Cache hit for schema at path: ${path}`);
      return cached;
    }
    logger.debug(`Getting schema for endpoint: ${path}`);
    try {
      const childResult = await this.client.execute("/console/inspect", { request: "child", path });
      const commands: string[] = [];
      if (Array.isArray(childResult)) {
        for (const item of childResult) { if (item.name) commands.push(item.name); }
      }
      const syntaxResult = await this.client.execute("/console/inspect", { request: "syntax", path });
      const parameters: EndpointParameter[] = [];
      if (syntaxResult && typeof syntaxResult === "object") {
        for (const [key, value] of Object.entries(syntaxResult)) {
          if (key !== ".id" && key !== ".tag" && typeof value === "object" && value !== null) {
            const param = value as Record<string, unknown>;
            parameters.push({ name: key, type: (param.type as string) || "string", required: (param.required as boolean) || false });
          }
        }
      }
      const schema: EndpointSchema = { path, commands, parameters };
      this.cache.set(cacheKey, schema, this.ttl);
      logger.debug(`Retrieved schema for endpoint: ${path}`);
      return schema;
    } catch (error) {
      logger.error(`Failed to get schema for endpoint ${path}:`, { error } as Record<string, unknown>);
      throw error;
    }
  }
}
