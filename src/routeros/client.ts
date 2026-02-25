/**
 * RouterOS API client with connection management and retry logic.
 *
 * Uses node-routeros for the RouterOS API protocol (port 8728/8729).
 */

import { RouterOSAPI } from "node-routeros";
import { logger } from "../utils/logger.js";
import { ConnectionError, AuthError, TimeoutError, RouterOSError } from "../utils/errors.js";
import { MAX_RETRIES, RETRY_BASE_DELAY } from "../constants.js";
import type { RosConnectionOptions, RosItem, RosCommandParams } from "./types.js";

export class RouterOSClient {
  private api: RouterOSAPI | null = null;
  private connected = false;
  private commandCount = 0;
  private readonly options: RosConnectionOptions;

  constructor(options: RosConnectionOptions) {
    this.options = options;
  }

  async connect(): Promise<void> {
    if (this.connected && this.api) return;
    try {
      this.api = new RouterOSAPI({
        host: this.options.host,
        port: this.options.port,
        user: this.options.username,
        password: this.options.password,
        tls: this.options.secure ? {} : undefined,
        timeout: this.options.timeout,
      });
      await this.api.connect();
      this.connected = true;
      logger.info("Connected to RouterOS", { host: this.options.host, port: this.options.port });
    } catch (error: unknown) {
      this.connected = false;
      this.api = null;
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("cannot log in") || msg.includes("invalid user")) {
        throw new AuthError(msg);
      } else if (msg.includes("ECONNREFUSED") || msg.includes("ECONNRESET")) {
        throw new ConnectionError(msg, `${this.options.host}:${this.options.port}`);
      } else if (msg.includes("ETIMEDOUT") || msg.includes("timeout")) {
        throw new TimeoutError(msg);
      }
      throw new ConnectionError(msg, `${this.options.host}:${this.options.port}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.api) {
      try { this.api.close(); } catch { /* Ignore close errors */ }
      this.api = null;
      this.connected = false;
      logger.info("Disconnected from RouterOS");
    }
  }

  isConnected(): boolean { return this.connected && this.api !== null; }

  async execute(command: string, params?: RosCommandParams): Promise<RosItem[]> {
    return this.executeWithRetry(command, params);
  }

  async write(command: string, params: RosCommandParams): Promise<RosItem[]> {
    return this.executeWithRetry(command, params);
  }

  private async executeWithRetry(command: string, params?: RosCommandParams, retries = MAX_RETRIES): Promise<RosItem[]> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await this.ensureConnected();
        const queryParams: string[] = [];
        if (params) {
          for (const [key, value] of Object.entries(params)) {
            if (value !== undefined && value !== "") queryParams.push(`=${key}=${value}`);
          }
        }
        logger.debug("Executing command", { command, params: queryParams, attempt });
        const result = await this.api!.write(command, queryParams);
        this.commandCount++;
        logger.debug("Command result", { command, resultCount: result.length });
        return result as RosItem[];
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes("cannot log in") || msg.includes("no such command") || msg.includes("invalid value") || msg.includes("already have")) throw error;
        if (attempt < retries) {
          const delay = RETRY_BASE_DELAY * Math.pow(2, attempt - 1);
          logger.warn(`Command failed, retrying in ${delay}ms`, { command, attempt, error: msg });
          this.connected = false;
          this.api = null;
          await this.sleep(delay);
        } else throw error;
      }
    }
    throw new RouterOSError("Max retries exceeded");
  }

  private async ensureConnected(): Promise<void> { if (!this.connected || !this.api) await this.connect(); }
  private sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

  getStats(): { connected: boolean; commandCount: number; host: string } {
    return { connected: this.connected, commandCount: this.commandCount, host: `${this.options.host}:${this.options.port}` };
  }
}
