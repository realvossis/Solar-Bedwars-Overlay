'use strict';
// Corner popups + sounds for things worth knowing mid-game: a good nick rolled, someone pinging or
// DMing you, a party invite, a threat joining your lobby, a Name Watch hit.
//
// The one hard rule: a notification must NEVER take focus from the game - losing focus mid-fight
// can lose you the game. So the popup lives in its own window that is:
//   - focusable: false  -> Windows never activates it (WS_EX_NOACTIVATE), not even on click
//   - shown with showInactive() only, never show()/focus()
//   - permanently click-through (setIgnoreMouseEvents) - nothing on it is interactive
//   - always-on-top at the same level as the overlay, so it's visible over a borderless game
// Popups dismiss themselves on a timer.
const { BrowserWindow, screen } = require('electron');
const path = require('path');

const WIDTH = 360, HEIGHT = 560, MARGIN = 14;

// A borderless-fullscreen game (Minecraft on F11) is itself a topmost window, and whenever it's
// activated it lands above every other topmost window - so a popup window created earlier ends up
// hidden behind the game. Re-asserting topmost + moving to the top of the stack puts it back in
// front WITHOUT activating it (both use SWP_NOACTIVATE), so the game keeps focus.
function raiseInactive(win) {
  if (!win || win.isDestroyed()) return;
  win.setAlwaysOnTop(true, 'screen-saver');
  win.moveTop();
}

// Event kinds and their Settings labels. Order = order shown in Settings.
const EVENTS = {
  nickMatch: 'Nick roller found a matching name',
  mention: 'Someone says your name in chat',
  dm: 'Direct message',
  partyInvite: 'Party invite',
  friendRequest: 'Friend request',
  threat: 'Threat joins your lobby (blacklisted or high sniper score)',
  nicked: 'Nicked player joins your lobby',
  nameWatch: 'Name Watch match',
};

class Notifier {
  constructor({ getConfig, webPreferences, anchorWindow }) {
    this.getConfig = getConfig;
    this.webPreferences = webPreferences;
    this.anchorWindow = anchorWindow; // () => overlay window, to pick the right monitor
    this.win = null;
    this.ready = null;
    this.seq = 0;
  }

  get window() { return this.win; }

  _cfg() { return this.getConfig().notifications || {}; }

  _ensureWindow() {
    if (this.win && !this.win.isDestroyed()) return this.ready;
    this.win = new BrowserWindow({
      width: WIDTH, height: HEIGHT, frame: false, transparent: true, resizable: false, movable: false,
      focusable: false, skipTaskbar: true, alwaysOnTop: true, fullscreenable: false, hasShadow: false,
      show: false, backgroundColor: '#00000000', title: 'Solar notifications',
      // Timers and audio must keep running while the window is hidden / never focused.
      webPreferences: { ...this.webPreferences, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
    });
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setIgnoreMouseEvents(true);
    this.win.on('closed', () => { this.win = null; this.ready = null; });
    this.ready = new Promise((resolve) => this.win.webContents.once('did-finish-load', resolve));
    this.win.loadFile(path.join(__dirname, '..', 'renderer', 'notify', 'notify.html'));
    return this.ready;
  }

  // Anchors the window to the chosen corner of the monitor the overlay is on.
  _place() {
    const pos = this._cfg().position || 'bottom-right';
    const anchor = this.anchorWindow && this.anchorWindow();
    const display = anchor && !anchor.isDestroyed() ? screen.getDisplayMatching(anchor.getBounds()) : screen.getPrimaryDisplay();
    const wa = display.workArea;
    const x = pos.endsWith('left') ? wa.x + MARGIN : wa.x + wa.width - WIDTH - MARGIN;
    const y = pos.startsWith('top') ? wa.y + MARGIN : wa.y + wa.height - HEIGHT - MARGIN;
    this.win.setBounds({ x: Math.round(x), y: Math.round(y), width: WIDTH, height: HEIGHT });
    this.win.setContentProtection(!!this.getConfig().hideFromCapture);
  }

  // Shows (and/or plays) a notification if the user has that event enabled. Returns the id when a
  // popup was shown, or null - callers fall back to the overlay's own toast in that case.
  async notify({ kind, title, text, player, stats }) {
    const c = this._cfg();
    const ev = (c.events || {})[kind] || {};
    const popup = c.enabled !== false && ev.popup !== false;
    const sound = c.enabled !== false && c.sound !== false && ev.sound !== false;
    if (!popup && !sound) return null;
    await this._ensureWindow();
    if (!this.win) return null;
    const id = ++this.seq;
    const payload = {
      id, kind, popup, sound, title: String(title || ''), text: text ? String(text).slice(0, 160) : '',
      player: player ? String(player) : null, stats: stats || null,
      position: c.position || 'bottom-right',
      durationMs: Math.max(2, Math.min(30, Number(c.durationSec) || 7)) * 1000,
      volume: Math.max(0, Math.min(1, Number(c.volume ?? 0.6))),
    };
    if (popup) { this._place(); if (!this.win.isVisible()) this.win.showInactive(); raiseInactive(this.win); }
    this.win.webContents.send('notify:show', payload);
    return popup ? id : null;
  }

  // Fills in a player's stats on a card that's already showing (lookups can take a moment).
  update(id, stats) { if (id && this.win && !this.win.isDestroyed()) this.win.webContents.send('notify:update', { id, stats }); }

  // The page reports when its last card has gone; hiding never touches focus either.
  idle() { if (this.win && !this.win.isDestroyed() && this.win.isVisible()) this.win.hide(); }

  preview() {
    const demo = (name, o) => ({ name, rank: 'MVP_PLUS', star: 537, starColor: '#55ffff', fkdr: 4.21, wlr: 2.1, finals: 25739, ws: 12, sniper: { score: 52, label: 'SWEAT', color: '#e3e327' }, tags: [], ...o });
    this.notify({ kind: 'nickMatch', title: 'Nick found', text: 'Matches "Cat" - click USE NAME to take it.', player: 'LuckyCat7' });
    setTimeout(() => this.notify({ kind: 'mention', title: 'Mentioned you', text: 'gg vossis that was close', player: 'Recoverin', stats: demo('Recoverin', { star: 301, starColor: '#55ffff', fkdr: 6.8, wlr: 3.4, finals: 18000, ws: 9, sniper: { score: 74, label: 'DANGER', color: '#ff6b35' } }) }), 450);
    setTimeout(() => this.notify({ kind: 'threat', title: 'Threat in your lobby', text: 'Blacklisted: snipes in 4s', player: 'Sheplock', stats: demo('Sheplock', { star: 912, fkdr: 11.4, wlr: 6.2, finals: 52000, ws: 38, sniper: { score: 93, label: 'SNIPER', color: '#ff2d55' }, tags: [{ label: 'SNIPE', color: '#ff5b8a' }] }) }), 900);
    setTimeout(() => this.notify({ kind: 'nicked', title: 'Nicked player in your lobby', text: 'Stats and blacklist tags are hidden behind the nick.', player: 'xX_Nicked_Xx', stats: { name: 'xX_Nicked_Xx', nicked: true } }), 1350);
  }

  destroy() { if (this.win && !this.win.isDestroyed()) this.win.destroy(); }
}

module.exports = { Notifier, EVENTS, raiseInactive };
