'use strict';
// Notifier tests with Electron stubbed out. The important one: the popup window must never be
// able to take focus from the game (non-focusable, click-through, only ever shown inactive).
const assert = require('assert');
const Module = require('module');

const calls = [];
class FakeWindow {
  constructor(opts) { this.opts = opts; this.visible = false; this.sent = []; this.webContents = { once: (_e, cb) => setTimeout(cb, 0), send: (ch, p) => this.sent.push([ch, p]) }; FakeWindow.last = this; }
  setAlwaysOnTop() {} setIgnoreMouseEvents(v) { this.clickThrough = v; } on() {} loadFile() {} setBounds(b) { this.bounds = b; } setContentProtection() {}
  isDestroyed() { return false; } isVisible() { return this.visible; }
  showInactive() { calls.push('showInactive'); this.visible = true; }
  show() { calls.push('show'); } focus() { calls.push('focus'); } hide() { this.visible = false; } destroy() {}
  moveTop() { calls.push('moveTop'); }
}
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'electron') return { BrowserWindow: FakeWindow, screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 2560, height: 1400 } }), getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 2560, height: 1400 } }) } };
  return origLoad.call(this, req, ...rest);
};
const { Notifier } = require('../src/main/notifications');
Module._load = origLoad;

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  ok  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' -> ' + e.message); } }

const make = (notifications) => new Notifier({ getConfig: () => ({ notifications, hideFromCapture: true }), webPreferences: {} });
const ALL_ON = { enabled: true, sound: true, events: {} };

(async () => {
  await t('popup window can never take focus', async () => {
    calls.length = 0;
    const n = make(ALL_ON);
    await n.notify({ kind: 'mention', title: 'x', player: 'P' });
    const w = FakeWindow.last;
    assert.strictEqual(w.opts.focusable, false, 'window must be non-focusable');
    assert.strictEqual(w.clickThrough, true, 'window must be click-through');
    assert.ok(calls.includes('showInactive'));
    assert.ok(!calls.includes('show') && !calls.includes('focus'), 'must never call show()/focus(): ' + calls.join(','));
    // Raised above a borderless-fullscreen game on every popup - without activation.
    assert.ok(calls.includes('moveTop'), 'popup must be raised to the top when shown');
  });
  await t('anchored to the chosen corner', async () => {
    const n = make({ ...ALL_ON, position: 'top-left' });
    await n.notify({ kind: 'dm', title: 'x' });
    assert.deepStrictEqual([FakeWindow.last.bounds.x, FakeWindow.last.bounds.y], [14, 14]);
  });
  await t('per-event popup/sound switches are honoured', async () => {
    const n = make({ ...ALL_ON, events: { threat: { popup: false, sound: true } } });
    const id = await n.notify({ kind: 'threat', title: 'x' });
    assert.strictEqual(id, null, 'no popup id -> caller falls back to overlay toast');
    const [, payload] = FakeWindow.last.sent.at(-1);
    assert.deepStrictEqual([payload.popup, payload.sound], [false, true]);
  });
  await t('master switch off: nothing at all', async () => {
    const n = make({ ...ALL_ON, enabled: false });
    FakeWindow.last = null;
    assert.strictEqual(await n.notify({ kind: 'mention', title: 'x' }), null);
    assert.strictEqual(FakeWindow.last, null, 'window should not even be created');
  });
  await t('global sound off mutes every event', async () => {
    const n = make({ ...ALL_ON, sound: false });
    await n.notify({ kind: 'nickMatch', title: 'x' });
    assert.strictEqual(FakeWindow.last.sent.at(-1)[1].sound, false);
  });
  await t('untrusted chat text is length-capped; volume and duration clamped', async () => {
    const n = make({ ...ALL_ON, volume: 7, durationSec: 999 });
    await n.notify({ kind: 'dm', title: 'x', text: 'y'.repeat(1000) });
    const p = FakeWindow.last.sent.at(-1)[1];
    assert.strictEqual(p.text.length, 160); assert.strictEqual(p.volume, 1); assert.strictEqual(p.durationMs, 30000);
  });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
