'use strict';
// Auto nick roller. You open Hypixel's random-name book yourself (/nick -> rank -> skin -> "Use a
// random name"), focus the game and press the hotkey; this then reads the rolled name off the
// screen (bookReader.js), checks it against your requirements, and clicks TRY AGAIN until one
// matches. On a match it stops with the book still open - picking USE NAME is always your click.
//
// It stops on its own whenever anything looks off: Minecraft loses focus, you move the mouse,
// the book disappears, a name can't be read, the roll limit is hit, or you press the hotkey.
const { EventEmitter } = require('events');
const nameRules = require('./nameRules');
const { readRolledName } = require('./bookReader');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIN_DELAY_MS = 700;         // never faster than this between rolls
const NEW_NAME_TIMEOUT_MS = 7000; // how long to wait for the book to show a new name
const MOUSE_TAKEOVER_PX = 30;     // you moved the mouse this far from our click -> you want control back

const REASONS = {
  'book not found': 'Random-name book not found on screen. Open it via /nick, and use borderless or windowed mode (exclusive fullscreen can\'t be captured).',
  'no readable name': 'Couldn\'t read the rolled name clearly - stopped rather than guess.',
  'no new name': 'TRY AGAIN didn\'t produce a new name in time (Hypixel may be rate-limiting) - try a longer delay.',
};

// Lunar runs as javaw; vanilla/most launchers as java/javaw too.
const isMinecraft = (fg) => !!fg && /^(javaw?|minecraft)$/i.test(fg.process || '');

// Requirements = the built-in checks you enabled AND (if you wrote any) at least one of your
// rules. Returns a function name -> { ok, why }.
function buildRequirements(cfg, extraRules = []) {
  const r = cfg || {};
  const compiled = nameRules.compile([...(r.rules || []), ...extraRules]);
  const checks = [];
  if (r.minLength > 3) checks.push((n) => n.length >= r.minLength || `shorter than ${r.minLength}`);
  if (r.maxLength && r.maxLength < 16) checks.push((n) => n.length <= r.maxLength || `longer than ${r.maxLength}`);
  if (r.noDigits) checks.push((n) => !/\d/.test(n) || 'has digits');
  if (r.noUnderscore) checks.push((n) => !n.includes('_') || 'has an underscore');
  const hasRules = compiled.rules.length > 0;
  return {
    empty: !hasRules && !checks.length,
    errors: compiled.errors,
    test(name) {
      for (const c of checks) { const res = c(name); if (res !== true) return { ok: false, why: res }; }
      if (!hasRules) return { ok: true, hits: [] };
      const hits = nameRules.match(compiled, name);
      return hits.length ? { ok: true, hits } : { ok: false, why: 'no rule matched' };
    },
  };
}

class NickRoller extends EventEmitter {
  // deps: { helper (WinHelper-like), loadGlyphs(), readFrame(w,h) -> RGBA frame, getConfig() }
  constructor(deps) {
    super();
    this.d = deps;
    this.running = false;
    this.stopReason = null;
    this.state = { running: false, rolls: 0, last: null, history: [], message: 'idle' };
  }

  _status(patch) {
    Object.assign(this.state, patch);
    this.emit('status', { ...this.state, history: this.state.history.slice(-25) });
  }

  stop(reason = 'stopped') { if (this.running) this.stopReason = reason; }
  toggle() { return this.running ? this.stop('stopped by hotkey') : this.start(); }

  async start() {
    if (this.running) return;
    const cfg = this.d.getConfig();
    const rc = cfg.nickRoller || {};
    const req = buildRequirements(rc, rc.useNameWatch ? ((cfg.nameWatch || {}).rules || []) : []);
    if (req.empty) return this._finish(null, 'Add at least one requirement or rule first (Settings → Nick Roller).', 'err');
    let glyphs;
    try { glyphs = this.d.loadGlyphs(); } catch (e) { return this._finish(null, e.message, 'err'); }

    this.running = true; this.stopReason = null;
    this._status({ running: true, rolls: 0, last: null, history: [], message: 'starting…' });
    const delay = Math.max(MIN_DELAY_MS, Number(rc.delayMs) || 1200);
    const maxRolls = Math.max(1, Math.min(5000, Number(rc.maxRolls) || 300));
    const h = this.d.helper;
    let result = null, kind = 'info', message;
    try {
      await h.start();
      const win = await h.foreground();
      if (!isMinecraft(win)) throw new Error('Focus Minecraft (with the random-name book open) before starting.');
      // Only the top-centre half of the window is ever needed - the book lives there. Cropping
      // symmetrically keeps the crop's centre on the window's centre, which bookReader relies on.
      const crop = { x: win.x + Math.floor(win.width / 4), y: win.y, w: Math.floor(win.width / 2), h: Math.floor(win.height / 2) };
      const grab = async () => { await h.capture(crop.x, crop.y, crop.w, crop.h); return this.d.readFrame(crop.w, crop.h); };

      let prev = null, lastClick = null;
      while (!this.stopReason) {
        const read = await this._awaitName(grab, glyphs, prev);
        if (this.stopReason) break;
        if (!read.ok) throw new Error(REASONS[read.reason] || read.reason);
        const verdict = req.test(read.name);
        this.state.history.push({ name: read.name, match: verdict.ok });
        this._status({ rolls: this.state.rolls + 1, last: read.name, message: verdict.ok ? 'match!' : 'rolling…' });
        if (verdict.ok) { result = read.name; kind = 'match'; message = `Rolled ${read.name} - matches${verdict.hits.length ? ' ' + verdict.hits.join(', ') : ' your requirements'}. Click USE NAME to take it.`; break; }
        if (this.state.rolls >= maxRolls) { message = `Stopped after ${maxRolls} rolls without a match.`; break; }

        await sleep(delay + Math.floor(Math.random() * 400));
        if (this.stopReason) break;
        // Hand control back the moment you touch the mouse or leave the game.
        if (lastClick) {
          const c = await h.cursor();
          if (Math.hypot(c.x - lastClick.x, c.y - lastClick.y) > MOUSE_TAKEOVER_PX) { this.stopReason = 'you moved the mouse'; break; }
        }
        const target = { x: crop.x + read.book.tryAgain.x, y: crop.y + read.book.tryAgain.y };
        if (!(await h.click(target.x, target.y, win.hwnd))) { this.stopReason = 'Minecraft is no longer the focused window'; break; }
        lastClick = target;
        prev = read.name;
      }
      if (!message) message = `Nick roller stopped: ${this.stopReason || 'done'} (${this.state.rolls} rolls).`;
    } catch (e) {
      kind = 'err'; message = String(e.message || e);
    }
    this.running = false;
    return this._finish(result, message, kind);
  }

  _finish(name, message, kind) {
    this._status({ running: false, message });
    this.emit('done', { name, message, kind, rolls: this.state.rolls });
    return name;
  }

  // Polls the screen until the book shows a name different from the previous roll.
  async _awaitName(grab, glyphs, prev) {
    // The book briefly closes while Hypixel generates the next name, so "not found" mid-roll is
    // normal - only the state at the deadline counts.
    const deadline = Date.now() + (prev ? NEW_NAME_TIMEOUT_MS : 1500);
    let reason = 'book not found';
    while (Date.now() < deadline && !this.stopReason) {
      const r = readRolledName(await grab(), glyphs);
      if (r.ok && r.name !== prev) return r;
      reason = r.ok ? 'no new name' : r.reason;
      await sleep(150);
    }
    return { ok: false, reason };
  }
}

module.exports = { NickRoller, buildRequirements, isMinecraft };
