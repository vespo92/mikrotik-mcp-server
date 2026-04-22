// Reproduce the ACTUAL code path: Channel constructor binds onUnknown via
// `.once('unknown', this.onUnknown.bind(this))`, then Channel.processPacket
// emits 'unknown' with '!empty'. Verify the patched handler is what fires.

import { EventEmitter } from 'node:events';
import { Channel } from 'node-routeros';
import { applyNodeRouterOsPatches } from '../dist/routeros/patches.js';

// Apply BEFORE constructing any Channel.
applyNodeRouterOsPatches();

const fakeConnector = new EventEmitter();
fakeConnector.destroy = () => {};
fakeConnector.stopRead = () => {};

// Install uncaughtException handler so we can see if anything slips past.
let uncaught = null;
process.on('uncaughtException', (e) => {
  uncaught = e;
});

// Construct Channel AFTER patch.
const ch = new Channel(fakeConnector);
ch.data = [];

let resolvedWith = undefined;
let rejected = null;

// Exercise the real `write` path which registers `.once('done', ...)`,
// `.once('trap', ...)` and invokes readAndWrite → processPacket via the
// fake connector.
fakeConnector.read = (_id, cb) => {
  // Simulate RouterOS replying with a single '!empty' sentence.
  queueMicrotask(() => cb(['!empty']));
};
fakeConnector.write = () => {};

try {
  const result = await Promise.race([
    ch.write([], false, true),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 1000)),
  ]);
  resolvedWith = result;
} catch (e) {
  rejected = e;
}

if (uncaught) {
  console.error('FAIL: uncaughtException fired:', uncaught.message);
  process.exit(1);
}
if (rejected) {
  console.error('FAIL: promise rejected:', rejected.message);
  process.exit(1);
}
if (!Array.isArray(resolvedWith)) {
  console.error('FAIL: expected array, got:', resolvedWith);
  process.exit(1);
}

console.log('PASS: real write path with !empty resolves as []');
console.log('      prototype onUnknown:', Channel.prototype.onUnknown.toString().slice(0, 100));
process.exit(0);
