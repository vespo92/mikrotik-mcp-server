import { RouterOSAPI } from 'node-routeros';

const api = new RouterOSAPI({
  host: '192.168.35.10',
  user: 'admin',
  password: 'Duckf@cemcgee2026!',
  port: 8728,
  timeout: 10,
});

const paths = [
  '/system/identity/print',
  '/system/routerboard/print',
  '/ip/address/print',
  '/ip/route/print',
  '/interface/print',
  '/interface/vlan/print',
  '/interface/bridge/print',
  '/interface/bridge/port/print',
  '/interface/bridge/vlan/print',
  '/interface/bonding/print',
  '/interface/ethernet/print',
];

await api.connect();
for (const p of paths) {
  try {
    const r = await api.write(p);
    console.log(`\n=== ${p} (${r.length}) ===`);
    console.log(JSON.stringify(r, null, 2));
  } catch (e) {
    if (e.errno === 'UNKNOWNREPLY' && String(e.message).includes('!empty')) {
      console.log(`\n=== ${p} (0 — empty) ===`);
    } else {
      console.log(`\n=== ${p} ERROR: ${e.message} ===`);
    }
  }
}
await api.close();
