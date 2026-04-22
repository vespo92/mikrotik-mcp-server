/**
 * Runtime monkey-patches for node-routeros.
 *
 * Must be imported (for side effects) before any `new RouterOSAPI()`.
 */

import { Channel } from "node-routeros";
import { logger } from "../utils/logger.js";

interface ChannelLike {
  trapped?: boolean;
  data?: unknown[];
  emit(event: string, ...args: unknown[]): boolean;
}

let applied = false;

/**
 * Bug: `Channel.prototype.onUnknown` throws `RosException('UNKNOWNREPLY')`
 * on any RouterOS reply that isn't `!re` / `!done` / `!fatal`. It's
 * registered as an event-emitter listener (`this.on('unknown', this.onUnknown.bind(this))`),
 * so the throw:
 *
 *   1. cannot be caught by try/catch around `api.write()` — it bubbles up
 *      from a later event-loop tick inside the socket 'data' handler
 *   2. crashes the Node process via `uncaughtException`
 *
 * Triggers on empty tables — RouterOS returns `!empty` as a terminal
 * sentence from e.g. `/interface/bridge/vlan/print` when no entries exist.
 *
 * Patch: emit `'done'` with the accumulated data (empty array for truly
 * empty tables) instead of throwing. Channel's pending promise resolves
 * normally. Other unrecognized replies are logged and also resolved empty
 * rather than crashing the process.
 */
export function applyNodeRouterOsPatches(): void {
  if (applied) return;
  applied = true;

  const proto = (Channel as unknown as {
    prototype: { onUnknown: (this: ChannelLike, reply: string) => void };
  }).prototype;

  if (typeof proto?.onUnknown !== "function") {
    logger.warn("node-routeros: Channel.prototype.onUnknown not found — skipping patch");
    return;
  }

  proto.onUnknown = function (this: ChannelLike, reply: string): void {
    logger.debug("node-routeros unknown reply (patched to resolve empty)", { reply });
    if (!this.trapped) this.emit("done", this.data ?? []);
  };

  logger.debug("node-routeros Channel.onUnknown patched");
}
