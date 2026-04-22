/**
 * RouterOS API client with serialized command queue, per-call timeout, and
 * single-generation reconnect.
 *
 * Design notes:
 *
 *  - node-routeros uses a single TCP socket per RouterOSAPI instance. Issuing
 *    concurrent writes on the same instance is not safe — responses can
 *    interleave or the session can drop. We serialize all commands through
 *    an internal promise queue so parallel tool calls from the MCP client
 *    don't corrupt each other.
 *
 *  - On error we increment a `generation` counter before resetting the
 *    connection. Concurrent callers that were waiting in the queue observe
 *    the new generation and reconnect cleanly instead of reusing a torn-down
 *    socket.
 *
 *  - Every command is wrapped in a hard timeout (COMMAND_TIMEOUT) so a stuck
 *    read never stalls the whole MCP session.
 */

import { applyNodeRouterOsPatches } from "./patches.js";
applyNodeRouterOsPatches();

import { RouterOSAPI } from "node-routeros";
import { logger } from "../utils/logger.js";
import { ConnectionError, AuthError, TimeoutError, RouterOSError } from "../utils/errors.js";
import { COMMAND_TIMEOUT, MAX_RETRIES, RETRY_BASE_DELAY } from "../constants.js";
import type { RosConnectionOptions, RosItem, RosCommandParams } from "./types.js";

/** Errors that must not be retried — retrying won't change the outcome. */
const NON_RETRYABLE = [
  "cannot log in",
  "invalid user",
  "no such command",
  "no such item",
  "invalid value",
  "already have",
  "failure: already have",
  "syntax error",
];

export class RouterOSClient {
  private api: RouterOSAPI | null = null;
  private connected = false;
  private commandCount = 0;
  private generation = 0;
  private queue: Promise<unknown> = Promise.resolve();
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
        timeout: Math.ceil(this.options.timeout / 1000),
      });
      await this.api.connect();
      this.connected = true;
      logger.info("Connected to RouterOS", {
        host: this.options.host,
        port: this.options.port,
        generation: this.generation,
      });
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
      try {
        this.api.close();
      } catch {
        // swallow errors during teardown
      }
      this.api = null;
      this.connected = false;
      this.generation++;
      logger.info("Disconnected from RouterOS");
    }
  }

  isConnected(): boolean {
    return this.connected && this.api !== null;
  }

  async execute(command: string, params?: RosCommandParams): Promise<RosItem[]> {
    return this.enqueue(() => this.run(command, params));
  }

  async write(command: string, params: RosCommandParams): Promise<RosItem[]> {
    return this.enqueue(() => this.run(command, params));
  }

  /**
   * Run `fn` after all previously-enqueued work has settled. This guarantees
   * only one RouterOS command is in flight against the socket at a time.
   */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    // keep queue chain alive regardless of individual outcomes
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async run(command: string, params?: RosCommandParams): Promise<RosItem[]> {
    const totalAttempts = MAX_RETRIES + 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
      const gen = this.generation;
      const startedAt = Date.now();
      try {
        await this.ensureConnected();

        const queryParams: string[] = [];
        if (params) {
          for (const [key, value] of Object.entries(params)) {
            if (value !== undefined && value !== "") queryParams.push(`=${key}=${value}`);
          }
        }

        logger.debug("routeros command start", { command, attempt });

        const result = await this.withTimeout(
          this.api!.write(command, queryParams),
          COMMAND_TIMEOUT,
          command
        );

        this.commandCount++;
        logger.debug("routeros command ok", {
          command,
          resultCount: Array.isArray(result) ? result.length : 0,
          elapsedMs: Date.now() - startedAt,
        });
        return result as RosItem[];
      } catch (error: unknown) {
        lastError = error;
        const msg = error instanceof Error ? error.message : String(error);
        const low = msg.toLowerCase();
        const elapsedMs = Date.now() - startedAt;

        if (NON_RETRYABLE.some((k) => low.includes(k))) {
          logger.debug("routeros command non-retryable", { command, error: msg, elapsedMs });
          throw error;
        }

        if (attempt >= totalAttempts) {
          logger.warn("routeros command failed (giving up)", { command, attempt, error: msg, elapsedMs });
          throw error;
        }

        const delay = RETRY_BASE_DELAY * Math.pow(2, attempt - 1);
        logger.warn("routeros command failed, retrying", { command, attempt, delay, error: msg, elapsedMs });

        // Only reset connection if nobody else has already done it. The
        // generation check prevents concurrent retries from all racing to
        // reconnect.
        if (gen === this.generation) {
          this.generation++;
          this.connected = false;
          if (this.api) {
            try {
              this.api.close();
            } catch {
              // ignore
            }
          }
          this.api = null;
        }

        await this.sleep(delay);
      }
    }

    throw lastError instanceof Error ? lastError : new RouterOSError("Max retries exceeded");
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connected || !this.api) await this.connect();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => {
        reject(new TimeoutError(`command timeout after ${ms}ms: ${label}`));
      }, ms);
      promise
        .then((v) => {
          clearTimeout(t);
          resolve(v);
        })
        .catch((e) => {
          clearTimeout(t);
          reject(e);
        });
    });
  }

  getStats(): { connected: boolean; commandCount: number; host: string; generation: number } {
    return {
      connected: this.connected,
      commandCount: this.commandCount,
      host: `${this.options.host}:${this.options.port}`,
      generation: this.generation,
    };
  }
}
