// Synthetic test for the node-routeros !empty crash fix.
// Verifies that Channel.onUnknown no longer throws and emits 'done' instead.
// No real router required.

import { EventEmitter } from 'node:events';
import { Channel } from 'node-routeros';
import { applyNodeRouterOsPatches } from '../dist/routeros/patches.js';

applyNodeRouterOsPatches();

// Fake connector so we can build a Channel instance
const fakeConnector = new EventEmitter();
fakeConnector.destroy = () => {};

const ch = new Channel(fakeConnector);
ch.data = [];

let doneData = null;
ch.on('done', (d) => { doneData = d; });

let threw = false;
try {
  // Simulate RouterOS terminal sentence for empty table
  ch.emit('unknown', '!empty');
} catch (e) {
  threw = true;
  console.error('FAIL: patched onUnknown still threw:', e?.message);
}

if (threw) process.exit(1);

if (!Array.isArray(doneData)) {
  console.error('FAIL: done event did not fire with array, got:', doneData);
  process.exit(1);
}

if (doneData.length !== 0) {
  console.error('FAIL: expected empty array, got:', doneData);
  process.exit(1);
}

console.log('PASS: !empty reply resolves as [] without throwing');
process.exit(0);
