/**
 * Runtime monkey-patches for node-routeros.
 *
 * Must be imported (for side effects) before any `new RouterOSAPI()`.
 */

import { Channel } from "node-routeros";
import { logger } from "../utils/logger.js";

interface ChannelLike {
  trapped?: boolean;
  streaming?: boolean;
  data?: unknown[];
  emit(event: string, ...args: unknown[]): boolean;
  close(force?: boolean): void;
}

let applied = false;
let processPacketPatched = false;
let onUnknownPatched = false;

/**
 * Bug: Channel.onUnknown throws RosException('UNKNOWNREPLY', { reply: '!empty' })
 * for any reply outside `!re / !done / !trap`. RouterOS returns `!empty` as a
 * terminal sentence on empty-table queries (e.g. /interface/bridge/vlan/print
 * on a fresh switch).
 *
 * The throw originates from an event-emitter listener registered in Channel's
 * constructor as `this.once('unknown', this.onUnknown.bind(this))` — it fires
 * on a later event-loop tick from inside the socket 'data' handler, so it
 * cannot be caught by try/catch around api.write() and crashes the process
 * via uncaughtException.
 *
 * Defense in depth:
 *
 *   1. processPacket patch (primary) — intercept `!empty` BEFORE emit('unknown')
 *      fires. Emit 'done' with accumulated data; the awaiting write() promise
 *      resolves normally. The 'unknown' listener never fires, so binding
 *      order of the original onUnknown is irrelevant.
 *
 *   2. onUnknown patch (secondary) — replace Channel.prototype.onUnknown with
 *      a no-throw version that emits 'done'. Catches any other code path
 *      that routes through `emit('unknown', ...)`.
 *
 *   3. process.on('uncaughtException') (tertiary, registered in index.ts) —
 *      if both of the above somehow fail, swallow RosException UNKNOWNREPLY
 *      with a warn log instead of crashing the process.
 */
export function applyNodeRouterOsPatches(): void {
  if (applied) return;
  applied = true;

  const proto = (Channel as unknown as {
    prototype: {
      onUnknown: (this: ChannelLike, reply: string) => void;
      processPacket: (this: ChannelLike, packet: string[]) => void;
    };
  }).prototype;

  // Primary: intercept before emit('unknown').
  if (typeof proto?.processPacket === "function") {
    const orig = proto.processPacket;
    proto.processPacket = function (this: ChannelLike, packet: string[]): void {
      if (packet && packet.length > 0 && packet[0] === "!empty") {
        logger.debug("node-routeros !empty intercepted (resolving as done with accumulated data)");
        if (!this.trapped) this.emit("done", this.data ?? []);
        this.close();
        return;
      }
      return orig.call(this, packet);
    };
    processPacketPatched = true;
  } else {
    logger.warn("node-routeros: Channel.prototype.processPacket not found — processPacket patch skipped");
  }

  // Secondary: replace onUnknown so it never throws.
  if (typeof proto?.onUnknown === "function") {
    proto.onUnknown = function (this: ChannelLike, reply: string): void {
      logger.debug("node-routeros unknown reply (patched to resolve empty)", { reply });
      if (!this.trapped) this.emit("done", this.data ?? []);
    };
    onUnknownPatched = true;
  } else {
    logger.warn("node-routeros: Channel.prototype.onUnknown not found — onUnknown patch skipped");
  }

  logger.debug("node-routeros patches applied", { processPacketPatched, onUnknownPatched });
}

/** Runtime inspection helper for the mcp_server_info tool. */
export function getPatchStatus(): {
  applied: boolean;
  processPacketPatched: boolean;
  onUnknownPatched: boolean;
} {
  return { applied, processPacketPatched, onUnknownPatched };
}
