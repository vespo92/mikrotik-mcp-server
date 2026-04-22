// Verify our process.on('uncaughtException') would catch a RosException
// thrown from an event-emitter callback (the actual failure mode).

import { EventEmitter } from 'node:events';
import { RosException } from 'node-routeros';

let caught = false;
let exited = false;
const originalExit = process.exit;
process.exit = (code) => { exited = true; throw new Error(`process.exit(${code}) blocked`); };

process.on('uncaughtException', (err) => {
  const errno = err?.errno || err?.code || '';
  const isUnknownReply = errno === 'UNKNOWNREPLY' ||
    (err?.name === 'RosException' && /UNKNOWNREPLY|unknown reply/i.test(err?.message ?? ''));
  if (isUnknownReply) {
    caught = true;
    console.log('CAUGHT:', { errno, name: err.name, message: err.message });
    return;
  }
  console.error('NOT CAUGHT (would fall through):', err);
});

// Simulate the throw from inside an EventEmitter listener.
const ee = new EventEmitter();
ee.once('boom', () => {
  throw new RosException('UNKNOWNREPLY', { reply: '!empty' });
});

ee.emit('boom');

await new Promise((r) => setTimeout(r, 100));

process.exit = originalExit;

if (exited) {
  console.error('FAIL: handler called process.exit (would crash server)');
  process.exit(1);
}
if (!caught) {
  console.error('FAIL: handler did not catch the exception');
  process.exit(1);
}
console.log('PASS: uncaughtException handler swallows UNKNOWNREPLY without exiting');
