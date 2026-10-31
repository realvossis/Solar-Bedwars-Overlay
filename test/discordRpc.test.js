'use strict';
// Discord IPC client against a fake pipe: framing, handshake, READY, dedupe, fallback, reconnect. Run: npm test
const assert = require('assert');
const { EventEmitter } = require('events');
const { DiscordRpc, encode, decode, OP } = require('../src/main/discordRpc');

let pass = 0, fail = 0;
const queue = [];
function t(name, fn) { queue.push([name, fn]); }

// A fake socket: records frames written to it; the test drives connect/data/close by hand.
class FakeSocket extends EventEmitter {
  constructor(path) { super(); this.path = path; this.out = []; this.ended = false; this.destroyed = false; }
  write(b) { this.out.push(...decode(b).frames); return true; }
  end(b) { if (b) this.write(b); this.ended = true; setImmediate(() => this.emit('close')); }
  destroy() { if (this.destroyed) return; this.destroyed = true; setImmediate(() => this.emit('close')); }
  reply(op, data) { this.emit('data', encode(op, data)); }
}
const tick = () => new Promise((r) => setImmediate(r));
const READY = { cmd: 'DISPATCH', evt: 'READY', data: { v: 1 } };
const activities = (s) => s.out.filter((f) => f.op === OP.FRAME && f.data.cmd === 'SET_ACTIVITY').map((f) => f.data.args.activity);

t('frames round-trip, including split chunks', () => {
  const a = encode(OP.FRAME, { x: 1 }), b = encode(OP.PING, { y: 'é' });
  const all = Buffer.concat([a, b]);
  const r1 = decode(all.subarray(0, a.length + 5));
  assert.deepStrictEqual(r1.frames, [{ op: OP.FRAME, data: { x: 1 } }]);
  const r2 = decode(Buffer.concat([r1.rest, all.subarray(a.length + 5)]));
  assert.deepStrictEqual(r2.frames, [{ op: OP.PING, data: { y: 'é' } }]); assert.strictEqual(r2.rest.length, 0);
});
t('rejects an absurd frame length', () => {
  const b = Buffer.alloc(8); b.writeInt32LE(1, 0); b.writeInt32LE(10 * 1024 * 1024, 4);
  assert.throws(() => decode(b));
});

t('handshakes with the client id, pushes the activity only after READY, skips repeats', async () => {
  const socks = [];
  const rpc = new DiscordRpc('123', { connect: (p) => { const s = new FakeSocket(p); socks.push(s); setImmediate(() => s.emit('connect')); return s; } });
  rpc.setActivity({ details: 'a' });
  rpc.start(); await tick();
  const s = socks[0];
  assert.deepStrictEqual(s.out[0], { op: OP.HANDSHAKE, data: { v: 1, client_id: '123' } });
  assert.strictEqual(activities(s).length, 0, 'nothing before READY');
  s.reply(OP.FRAME, READY);
  assert.deepStrictEqual(activities(s), [{ details: 'a' }]);
  rpc.setActivity({ details: 'a' });
  assert.strictEqual(activities(s).length, 1, 'identical activity not resent');
  rpc.setActivity(null);
  assert.deepStrictEqual(activities(s), [{ details: 'a' }, null]);
  s.reply(OP.PING, { n: 7 });
  assert.deepStrictEqual(s.out[s.out.length - 1], { op: OP.PONG, data: { n: 7 } });
  rpc.stop(); await tick();
  assert.ok(s.ended); assert.strictEqual(s.out[s.out.length - 1].op, OP.CLOSE);
});

t('falls through to the next pipe when one is missing', async () => {
  const tried = [];
  const rpc = new DiscordRpc('1', { connect: (p) => {
    const s = new FakeSocket(p); tried.push(p);
    setImmediate(() => (tried.length < 3 ? s.emit('close') : s.emit('connect')));
    return s;
  } });
  rpc.start();
  for (let i = 0; i < 6; i++) await tick();
  assert.deepStrictEqual(tried.map((p) => p.slice(-1)), ['0', '1', '2']);
  assert.ok(rpc.socket && rpc.socket.path.endsWith('2'));
  rpc.stop();
});

t('reconnects after Discord closes and re-sends the current activity', async () => {
  const socks = [];
  const rpc = new DiscordRpc('1', { retryMs: 5, connect: (p) => { const s = new FakeSocket(p); socks.push(s); setImmediate(() => s.emit('connect')); return s; } });
  let gone = 0; rpc.on('disconnected', () => gone++);
  rpc.setActivity({ state: 'x' });
  rpc.start(); await tick();
  socks[0].reply(OP.FRAME, READY);
  socks[0].destroy(); await tick();
  assert.strictEqual(gone, 1); assert.strictEqual(rpc.ready, false);
  await new Promise((r) => setTimeout(r, 20));
  const s2 = socks[socks.length - 1];
  assert.notStrictEqual(s2, socks[0]);
  s2.reply(OP.FRAME, READY);
  assert.deepStrictEqual(activities(s2), [{ state: 'x' }]);
  rpc.stop();
});

t('stop() during a pending connect never adopts the late socket', async () => {
  const socks = [];
  const rpc = new DiscordRpc('1', { connect: (p) => { const s = new FakeSocket(p); socks.push(s); return s; } });
  rpc.start(); rpc.stop();
  socks[0].emit('connect'); await tick();
  assert.strictEqual(rpc.socket, null); assert.ok(socks[0].destroyed);
  assert.strictEqual(socks[0].out.length, 0, 'no handshake on a socket nobody wants');
});

t('garbage from the pipe drops the connection instead of throwing', async () => {
  const socks = [];
  const rpc = new DiscordRpc('1', { retryMs: 60000, connect: (p) => { const s = new FakeSocket(p); socks.push(s); setImmediate(() => s.emit('connect')); return s; } });
  rpc.start(); await tick();
  const bad = Buffer.alloc(12); bad.writeInt32LE(1, 0); bad.writeInt32LE(4, 4); bad.write('{{{{', 8);
  socks[0].emit('data', bad); await tick();
  assert.ok(socks[0].destroyed); assert.strictEqual(rpc.socket, null);
  rpc.stop();
});

t('a pipe that never sends READY is dropped and retried', async () => {
  const socks = [];
  const rpc = new DiscordRpc('1', { retryMs: 5, readyMs: 10, connect: (p) => { const s = new FakeSocket(p); socks.push(s); setImmediate(() => s.emit('connect')); return s; } });
  rpc.start();
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(socks[0].destroyed, 'silent pipe dropped');
  assert.ok(socks.length >= 2, 'reconnected');
  rpc.stop();
});

(async () => {
  for (const [name, fn] of queue) {
    try { await fn(); pass++; console.log('  ok  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' -> ' + e.message); }
  }
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
