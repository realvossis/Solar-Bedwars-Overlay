'use strict';
// Minimal Discord Rich Presence client over Discord's local IPC pipe - no dependency, nothing
// leaves the machine (the pipe is the desktop Discord app itself). Protocol: every message is a
// frame of [int32 LE opcode][int32 LE length][JSON]. Handshake once, then SET_ACTIVITY frames.
// Discord clears the activity on its own when the socket closes or `pid` exits, so quitting
// Solar (or a crash) can never leave a stale presence behind.
const net = require('net');
const path = require('path');
const { EventEmitter } = require('events');

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };
const MAX_FRAME = 64 * 1024; // real frames are a few hundred bytes; anything bigger is not Discord

function encode(op, data) {
  const json = Buffer.from(JSON.stringify(data), 'utf8');
  const b = Buffer.alloc(8 + json.length);
  b.writeInt32LE(op, 0); b.writeInt32LE(json.length, 4); json.copy(b, 8);
  return b;
}
// Splits buffered bytes into whole frames; a partial frame stays in `rest` for the next chunk.
// A frame that claims to be huge or isn't JSON throws - the caller drops the connection.
function decode(buf) {
  const frames = [];
  let off = 0;
  while (buf.length - off >= 8) {
    const op = buf.readInt32LE(off), len = buf.readInt32LE(off + 4);
    if (len < 0 || len > MAX_FRAME) throw new Error('bad frame length ' + len);
    if (buf.length - off - 8 < len) break;
    frames.push({ op, data: JSON.parse(buf.toString('utf8', off + 8, off + 8 + len)) });
    off += 8 + len;
  }
  return { frames, rest: buf.subarray(off) };
}
function pipePath(i) {
  if (process.platform === 'win32') return '\\\\?\\pipe\\discord-ipc-' + i;
  const dir = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || '/tmp';
  return path.join(dir, 'discord-ipc-' + i);
}

// Events: 'ready' (logged in, activity pushed), 'disconnected', 'error' (Discord refused a frame).
class DiscordRpc extends EventEmitter {
  constructor(clientId, { connect = (p) => net.createConnection(p), retryMs = 15000, readyMs = 10000 } = {}) {
    super();
    this.clientId = clientId; this._connect = connect; this.retryMs = retryMs; this.readyMs = readyMs; this.readyTimer = null;
    this.ready = false; this.wanted = false; this.socket = null; this.retry = null;
    this.activity = null; this.sent = undefined; this.nonce = 0; this.buf = Buffer.alloc(0);
  }
  // `gen` invalidates a connect attempt still in flight when stop()/start() is called again.
  start() { if (this.wanted) return; this.wanted = true; this.gen = (this.gen || 0) + 1; this._tryPipe(0, this.gen); }
  stop() {
    this.wanted = false; this.gen = (this.gen || 0) + 1; clearTimeout(this.retry); this.retry = null; clearTimeout(this.readyTimer);
    const s = this.socket;
    this.socket = null; this.ready = false; this.sent = undefined;
    if (s) { try { s.end(encode(OP.CLOSE, {})); } catch (_) {} }
  }
  // null clears it. Identical repeats are skipped: Discord rate-limits SET_ACTIVITY (~5 per 20s).
  setActivity(activity) { this.activity = activity || null; this._push(); }

  _tryPipe(i, gen) {
    if (!this.wanted || this.socket || gen !== this.gen) return;
    if (i > 9) { this._scheduleRetry(); return; } // Discord isn't running (or has no pipe yet)
    let s;
    try { s = this._connect(pipePath(i)); } catch (_) { this._tryPipe(i + 1, gen); return; }
    let opened = false;
    s.once('connect', () => {
      opened = true;
      if (gen !== this.gen || this.socket) { s.destroy(); return; }
      this.socket = s; this.buf = Buffer.alloc(0);
      s.write(encode(OP.HANDSHAKE, { v: 1, client_id: this.clientId }));
      // a pipe that accepts but never says READY would otherwise hold the slot forever
      clearTimeout(this.readyTimer);
      this.readyTimer = setTimeout(() => { if (this.socket === s && !this.ready) s.destroy(); }, this.readyMs);
    });
    s.on('data', (chunk) => this._onData(s, chunk));
    s.on('error', () => {}); // 'close' follows and decides what to do
    s.on('close', () => {
      if (!opened) { this._tryPipe(i + 1, gen); return; }
      if (this.socket !== s) return;
      const was = this.ready; this._drop();
      if (was) this.emit('disconnected');
      this._scheduleRetry();
    });
  }
  _onData(s, chunk) {
    if (this.socket !== s) return;
    let res;
    try { res = decode(Buffer.concat([this.buf, chunk])); } catch (_) { s.destroy(); return; }
    this.buf = res.rest;
    if (this.buf.length > MAX_FRAME) { s.destroy(); return; }
    for (const f of res.frames) {
      if (f.op === OP.PING) s.write(encode(OP.PONG, f.data));
      else if (f.op === OP.CLOSE) s.destroy();
      else if (f.op === OP.FRAME && f.data) {
        if (f.data.cmd === 'DISPATCH' && f.data.evt === 'READY') {
          this.ready = true; this.sent = undefined; this._push(); this.emit('ready');
        } else if (f.data.evt === 'ERROR') {
          this.emit('error', new Error((f.data.data && f.data.data.message) || 'Discord RPC error'));
        }
      }
    }
  }
  _push() {
    if (!this.ready || !this.socket) return;
    const key = JSON.stringify(this.activity);
    if (key === this.sent) return;
    this.sent = key;
    try {
      this.socket.write(encode(OP.FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: this.activity }, nonce: String(++this.nonce) }));
    } catch (_) {}
  }
  _drop() {
    const s = this.socket;
    this.socket = null; this.ready = false; this.sent = undefined; this.buf = Buffer.alloc(0); clearTimeout(this.readyTimer);
    if (s) { try { s.destroy(); } catch (_) {} }
  }
  _scheduleRetry() {
    if (!this.wanted || this.retry) return;
    const gen = this.gen;
    this.retry = setTimeout(() => { this.retry = null; this._tryPipe(0, gen); }, this.retryMs);
  }
}

module.exports = { DiscordRpc, encode, decode, pipePath, OP };
