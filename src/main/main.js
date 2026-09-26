'use strict';
const { app, BrowserWindow, ipcMain, globalShortcut, dialog, Tray, Menu, nativeImage, shell, session, screen, clipboard } = require('electron');
const path = require('path');

// Dev-only: point a `npm run dev` session at a throwaway profile (SOLAR_USER_DATA=some/dir) so
// testing never touches your real config/keys. Ignored entirely in the packaged app.
if (!app.isPackaged && process.env.SOLAR_USER_DATA) app.setPath('userData', path.resolve(process.env.SOLAR_USER_DATA));

const config = require('./config');
const { Hypixel } = require('./hypixel');
const { Urchin } = require('./urchin');
const { Roster } = require('./roster');
const { LogWatcher, validName } = require('./logWatcher');
const nameRules = require('./nameRules');
const fs = require('fs');
const { NickRoller, buildRequirements } = require('./nickRoller');
const { Notifier, raiseInactive } = require('./notifications');
const chatWarn = require('./chatWarn');
const statsLib = require('./stats');
const { WinHelper } = require('./winHelper');
const { loadFont } = require('./bookReader');
const { readEntry } = require('./zipReader');
const png = require('./png');

// ---------------- rendering pipeline ----------------
// The overlay is a transparent, topmost window sitting directly over Minecraft's OpenGL surface.
// With Chromium's GPU compositor running, some drivers report GL_INVALID_OPERATION (1282) in the
// game - two GPU clients fighting over the same composited region. Software rendering takes the
// overlay out of the GPU pipeline entirely, and costs nothing noticeable for a small table.
// Must be decided before 'ready', hence the raw early read (see config.readEarly).
const gpuAtLaunch = !!config.readEarly('gpuAcceleration', false);
if (!gpuAtLaunch) app.disableHardwareAcceleration();

let overlayWin = null, settingsWin = null, blacklistWin = null, splashWin = null, tray = null;
let hypixel, urchin, roster, watcher, nickRoller, notifier;
let refreshTimer = null;
let lastLogStatus = { ok: false, msg: 'not started' };
// The last known raw server code (e.g. "mini116CN", "dynamiclobby25G", "limbo") - undefined until
// something's actually been observed this launch. "mini*" is your real, small match instance;
// "dynamiclobby*" is BedWars' shared matchmaking staging pool, which turned out to be just as
// noisy as the hub despite technically being gametype BEDWARS (see logWatcher.js) - so
// inBedwarsMatch() below, not a plain gametype check, is what actually gates lobbyJoin/chatSpeaker.
let currentServer;
function inBedwarsMatch() { return typeof currentServer === 'string' && /^mini/i.test(currentServer); }

const getConfig = () => config.load();
const ICON = path.join(__dirname, '..', '..', 'assets', 'icon-256.png');

// Every window gets the same locked-down renderer: no Node, isolated context, OS-level sandbox.
// The preload's contextBridge API is the only thing a page can reach.
const SECURE_PREFS = { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false, spellcheck: false };

// ---------------- windows ----------------
function createOverlay() {
  const cfg = getConfig();
  overlayWin = new BrowserWindow({
    x: cfg.window.x, y: cfg.window.y, width: cfg.window.width, height: cfg.window.height,
    minWidth: 320, minHeight: 120,
    frame: false, transparent: true, resizable: true, movable: true, fullscreenable: false,
    alwaysOnTop: cfg.alwaysOnTop, skipTaskbar: false, backgroundColor: '#00000000',
    hasShadow: false, title: 'Solar Overlay', show: false,
    icon: ICON,
    webPreferences: SECURE_PREFS,
  });
  applyAlwaysOnTop();
  applyCapture();
  applyClickThrough();
  overlayWin.setOpacity(cfg.window.opacity ?? 0.94);
  overlayWin.loadFile(path.join(__dirname, '..', 'renderer', 'overlay', 'overlay.html'));
  blockFullscreenKey(overlayWin);

  // Debounced: a drag fires 'moved'/'resized' dozens of times a second, and each save is a disk write.
  let persistTimer = null;
  const persist = () => {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      if (!overlayWin || overlayWin.isDestroyed()) return;
      const b = overlayWin.getBounds();
      config.save({ window: { ...getConfig().window, x: b.x, y: b.y, width: b.width, height: b.height } });
    }, 250);
  };
  overlayWin.on('moved', persist);
  overlayWin.on('resized', persist);
  overlayWin.on('closed', () => { overlayWin = null; });
}

// A one-time-per-launch title animation. It owns its own ~6s timing (see splash.js) and
// reports back over IPC when it's done rather than main.js guessing a delay. Non-focusable and
// shown inactive: launching the app while in a game must never pull focus out of it.
function createSplash() {
  splashWin = new BrowserWindow({
    width: 640, height: 400, frame: false, transparent: true, resizable: false, movable: false,
    fullscreenable: false, alwaysOnTop: true, skipTaskbar: true, backgroundColor: '#00000000',
    hasShadow: false, show: false, center: true, focusable: false,
    icon: ICON,
    // The startup soundtrack plays without a click (the window can't even be clicked into).
    webPreferences: { ...SECURE_PREFS, autoplayPolicy: 'no-user-gesture-required' },
  });
  splashWin.once('ready-to-show', () => splashWin.showInactive());
  splashWin.loadFile(path.join(__dirname, '..', 'renderer', 'splash', 'splash.html'));
  splashWin.on('closed', () => { splashWin = null; });
  // Safety net: if the splash page ever fails to report in, don't leave the overlay hidden forever.
  setTimeout(finishSplash, 12000);
}
function finishSplash() {
  if (splashWin && !splashWin.isDestroyed()) splashWin.close();
  splashFinished = true;
  applyOverlayVisibility();
}

// ---------------- overlay visibility ----------------
// overlayMode (Settings -> Appearance):
//   auto   - shown in lobbies and the BEDWARS pre-game lobby (where you scout players); hidden once a
//            match starts and in every other game (Duels, SkyWars, ...) from the moment you join.
//            Alt+B overrides it until the next phase change.
//   manual - hidden unless you show it with Alt+B (or the tray); your choice sticks.
//   always - always shown; Alt+B still hides it and that choice sticks.
// Notifications are separate and keep working in every mode.
let splashFinished = false, inMatch = false, overlayOverride = null, matchStartTimer = null, lobbyTimer = null;
let currentGametype = null, currentMode = null;
const overlayMode = () => { const m = getConfig().overlayMode; return m === 'manual' || m === 'always' ? m : 'auto'; };
function overlayWanted() {
  if (overlayOverride !== null) return overlayOverride;
  const mode = overlayMode();
  if (mode === 'always') return true;
  if (mode === 'manual') return false;
  return !inMatch;
}
function applyOverlayVisibility() {
  if (!overlayWin || overlayWin.isDestroyed() || !splashFinished) return;
  const want = overlayWanted();
  if (want && !overlayWin.isVisible()) overlayWin.showInactive();
  else if (!want && overlayWin.isVisible()) overlayWin.hide();
}
function setInMatch(v) {
  clearTimeout(matchStartTimer); matchStartTimer = null;
  clearTimeout(lobbyTimer); lobbyTimer = null;
  if (inMatch === v) return;
  inMatch = v;
  if (overlayMode() === 'auto') overlayOverride = null; // in auto, an Alt+B choice lasts one phase
  applyOverlayVisibility();
}

// Each of these touches window state the OS compositor (DWM) cares about - topmost z-order and
// capture exclusion. They're only re-applied when their own setting actually changes, never on
// every unrelated config save (sorting a column, dragging the window...), so the overlay isn't
// constantly re-poking the compositor while the game is rendering underneath it.
function applyAlwaysOnTop() {
  if (!overlayWin) return;
  overlayWin.setAlwaysOnTop(!!getConfig().alwaysOnTop, 'screen-saver');
}
function applyCapture() {
  if (!overlayWin) return;
  overlayWin.setContentProtection(!!getConfig().hideFromCapture); // WDA_EXCLUDEFROMCAPTURE on Windows
}
// Click-through makes the whole window ignore the mouse - which used to include the very button
// that turns it off, leaving the overlay stuck (and the setting persists across restarts). So while
// it's on, the cursor is polled and the title bar strip becomes clickable whenever the cursor is
// over it. Polling instead of Electron's forwarded mouse-moves: those turned out not to arrive at
// all with this window setup (verified with a real-mouse test).
const TITLEBAR_H = 38; // DIP: 36px bar + borders
let ctPoll = null, ctInteractive = false;
function applyClickThrough() {
  if (!overlayWin) return;
  const on = !!getConfig().clickThrough;
  ctInteractive = false;
  overlayWin.setIgnoreMouseEvents(on, { forward: true });
  if (on && !ctPoll) ctPoll = setInterval(pollClickThrough, 80);
  if (!on && ctPoll) { clearInterval(ctPoll); ctPoll = null; }
}
function pollClickThrough() {
  if (!overlayWin || overlayWin.isDestroyed() || !getConfig().clickThrough || (nickRoller && nickRoller.running)) return;
  const p = screen.getCursorScreenPoint(), b = overlayWin.getBounds();
  const over = overlayWin.isVisible() && p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + TITLEBAR_H;
  if (over !== ctInteractive) { ctInteractive = over; overlayWin.setIgnoreMouseEvents(!over, { forward: true }); }
}

// The overlay is frameless and meant to sit as a small always-on-top strip, so an
// accidental F11 blowing it up to fullscreen is just disruptive, not useful — block it.
function blockFullscreenKey(win) {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') event.preventDefault();
  });
}

function childWindow(file, opts = {}) {
  const win = new BrowserWindow({
    width: opts.width || 760, height: opts.height || 620, frame: false, resizable: true, fullscreenable: false,
    backgroundColor: '#0d1117', title: opts.title || 'Solar',
    icon: ICON,
    webPreferences: SECURE_PREFS,
  });
  win.loadFile(file);
  blockFullscreenKey(win);
  return win;
}

// Bring an existing child window back to front, undoing minimize/hide state.
// A plain .focus() is a no-op on a minimized Windows BrowserWindow, which used
// to make Settings look "stuck closed" once it had been minimized at any point.
function wake(win) {
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}
function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { wake(settingsWin); return; }
  settingsWin = childWindow(path.join(__dirname, '..', 'renderer', 'settings', 'settings.html'), { title: 'Settings', width: 820, height: 700 });
  settingsWin.on('closed', () => { settingsWin = null; });
}
function openBlacklist() {
  if (blacklistWin && !blacklistWin.isDestroyed()) { wake(blacklistWin); return; }
  blacklistWin = childWindow(path.join(__dirname, '..', 'renderer', 'blacklist', 'blacklist.html'), { title: 'Blacklist Admin', width: 720, height: 640 });
  blacklistWin.on('closed', () => { blacklistWin = null; });
}

// Only the Settings window ever needs to see real API keys (to edit them). Everything else gets
// a redacted copy - the overlay has no use for them, so a bug there can't leak one.
function configFor(win) { const c = getConfig(); return win && win === settingsWin ? c : config.redact(c); }
function broadcastConfig() {
  for (const w of [overlayWin, settingsWin, blacklistWin]) if (w && !w.isDestroyed()) w.webContents.send('config:changed', configFor(w));
}
function broadcast(channel, payload) {
  for (const w of [overlayWin, settingsWin, blacklistWin]) if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
}
function toast(msg, kind = 'info') { broadcast('toast', { msg, kind, ts: Date.now() }); }

// ---------------- log watcher wiring ----------------
function startWatcher() {
  const cfg = getConfig();
  watcher.setSelfNames([cfg.selfName, ...(cfg.reactNames || [])]);
  if (cfg.logEnabled) watcher.start(cfg.logPath); else watcher.stop();
}

async function watchlistAdd(name, reason, kind) {
  try {
    const r = await hypixel.resolveUuid(name);
    if (!r) return;
    const cfg = getConfig();
    const wl = { ...(cfg.watchlist || {}) };
    wl[r.id] = { name: r.name, reason, added_on: new Date().toISOString() };
    config.save({ watchlist: wl });
    roster.addNames([r.name], kind || 'trigger');
    toast(`Flagged ${r.name}: ${reason}`, 'warn');
  } catch (_) {}
}

function wireWatcher() {
  // "ONLINE: a, b, c" is the full-lobby list a client dumps on load (via /who or auto-who) —
  // clearOnLobbyJoin wipes stale entries right before repopulating from that fresh list, a
  // safety net for when serverChange's own detection doesn't fire first.
  watcher.on('who', (names) => { if (getConfig().clearOnLobbyJoin) roster.clear(); roster.addNames(names, 'GAME'); });
  // Both of these are passive background noise-pickers, not a deliberate action like /who - so
  // both require inBedwarsMatch() (your actual small match instance), not just "somewhere
  // Bedwars-flagged" - the shared matchmaking staging lobby is also gametype BEDWARS but is just
  // as noisy as the hub, see currentServer's comment above.
  watcher.on('lobbyJoin', (n) => { if (inBedwarsMatch()) roster.addNames([n], 'GAME'); });
  // Opt-in (see trackChatSpeakers in Settings) on top of that - some people still don't want
  // random match-lobby chatter added even once scoped correctly.
  watcher.on('chatSpeaker', (n) => { if (getConfig().trackChatSpeakers && inBedwarsMatch()) roster.addNames([n], 'GAME'); });
  watcher.on('quit', (n) => roster.markLeft(n));
  // Housing fires its own serverChange twice in a row - once for the housing lobby, once more
  // for the actual house instance right after the teleport message names its owner - so a plain
  // clear-on-serverChange would wipe the owner right back out the moment they're added. Re-add
  // them once, but only if that second serverChange lands within a few seconds of the teleport;
  // past that it's a stale value from some earlier, unrelated house and shouldn't leak forward.
  // (Housing has none of Bedwars' lobby-fill/kill-feed chatter, so the owner is the one useful
  // thing to auto-track there.)
  let pendingHouseOwner = null, pendingHouseOwnerTs = 0;
  watcher.on('houseEntered', (owner) => {
    pendingHouseOwner = owner; pendingHouseOwnerTs = Date.now();
    roster.addNames([owner], 'house');
  });
  // Match phases -> overlay auto-hide.
  watcher.on('matchStarting', () => { clearTimeout(matchStartTimer); matchStartTimer = setTimeout(() => setInMatch(true), 1500); });
  watcher.on('matchStart', () => setInMatch(true));
  watcher.on('matchEnd', () => setInMatch(false));
  watcher.on('serverChange', (info) => {
    if (info && info.server !== undefined) {
      // Exact answer from the client's status blob: a "mode" means a game instance. Bedwars games
      // start with a pre-game lobby worth scouting (hidden later by the start banner); any other
      // game (Duels, SkyWars, ...) counts as "in a match" right away. No mode = a lobby.
      currentGametype = info.gametype || null;
      currentMode = info.mode || null;
      setInMatch(!!info.mode && info.gametype !== 'BEDWARS');
    } else {
      // Plain-text fallback ("Sending you to ...") can't say where to - wait briefly for the exact
      // blob instead of flashing the overlay up on the way into a Duels game.
      clearTimeout(lobbyTimer);
      lobbyTimer = setTimeout(() => setInMatch(false), 2500);
    }
    // undefined means "changed servers, but we don't actually know which one" (the plain-text
    // fallback patterns can't tell) - leave currentServer alone rather than guessing. Any real
    // string (including "limbo") is an actual answer from the JSON status blob and overwrites it.
    if (info && info.server !== undefined) currentServer = info.server;
    threatsAlerted.clear(); nicksAlerted.clear(); // new lobby: fresh heads-ups
    partyWarned.clear(); partyWarnQueue.length = 0; publicWarnIndex = 0; pendingDodge = null; dodgedThisLobby = false;
    if (getConfig().clearOnServerChange) roster.clear();
    if (pendingHouseOwner && Date.now() - pendingHouseOwnerTs < 8000) roster.addNames([pendingHouseOwner], 'house');
    pendingHouseOwner = null;
  });

  // ---- party: tracked from every signal Hypixel gives, so /p list is never required ----
  watcher.on('partyJoin', (names) => {
    roster.addNames(names, 'PARTY');
    if (getConfig().triggers.onPartyJoin) names.forEach((n) => watchlistAdd(n, 'joined your party', 'PARTY'));
  });
  // You accepted someone's invite: whatever party you were in before is over, and the leader -
  // who used to vanish from the list here - is the first member of the new one. The rest arrive
  // on the "You'll be partying with:" line right after.
  watcher.on('partyJoined', (leader) => { roster.disbandParty(); roster.addNames([leader], 'PARTY'); });
  watcher.on('partyMember', (n) => roster.addNames([n], 'PARTY'));
  watcher.on('partyList', (names) => roster.addNames(names, 'PARTY'));
  watcher.on('partyRoster', (names) => roster.setParty(names));
  watcher.on('partyLeave', (n) => roster.leaveParty(n));
  watcher.on('partyDisband', () => roster.disbandParty());

  // Each trigger passes its own "kind" through to the roster row so the overlay can show
  // a distinct badge for how a player was actually detected (party, mention, DM, ...),
  // not just a generic "flagged" marker.
  watcher.on('partyInvite', (n) => {
    if (getConfig().triggers.onPartyInvite) watchlistAdd(n, 'party invite', 'partyInvite');
    notifyUser('partyInvite', { title: 'Party invite', player: n }, `Party invite from ${n}`);
  });
  watcher.on('friendRequest', (n) => {
    if (getConfig().triggers.onFriendRequest) watchlistAdd(n, 'friend request', 'friendRequest');
    notifyUser('friendRequest', { title: 'Friend request', player: n }, `Friend request from ${n}`);
  });
  watcher.on('dmFrom', (n, text) => {
    if (getConfig().triggers.onDirectMessage) watchlistAdd(n, 'DM: ' + (text || '').slice(0, 40), 'dm');
    notifyUser('dm', { title: 'Direct message', player: n, text }, `DM from ${n}`);
  });
  watcher.on('mention', ({ by, text }) => {
    if (getConfig().triggers.onNameInChat) watchlistAdd(by, 'said your name: ' + (text || '').slice(0, 40), 'mention');
    notifyUser('mention', { title: 'Mentioned you', player: by, text }, `${by} mentioned you`, 'warn');
  });
  // De-nick attempt: match the killer's reported lifetime final-kill count against players this
  // app has already seen stats for (see hypixel.findByFinalKills — there's no way to search
  // Hypixel-wide, only what's locally cached). Only useful when it points somewhere other than
  // the name already on-screen.
  watcher.on('finalKillCount', ({ killer, count }) => {
    const candidates = hypixel.findByFinalKills(count, 2).filter((c) => c.name.toLowerCase() !== killer.toLowerCase());
    if (!candidates.length) return;
    roster.setDenickHint(killer, { count, candidates, ts: Date.now() });
    if (candidates.length === 1) toast(`Possible nick: ${killer} -> ${candidates[0].name}?`, 'warn');
  });
  // Cached so a renderer that (re)loads after this has already fired at least once - which is
  // the usual case, since the overlay's own script takes a moment to load and register its
  // onLogStatus listener after createOverlay() kicks off startWatcher() - can still ask for the
  // current status instead of being stuck showing whatever the logdot's default markup was until
  // the next actual change (which might be a long time, or never).
  watcher.on('status', (s) => { lastLogStatus = s; broadcast('log:status', s); });
}

// ---------------- notifications ----------------
// Corner popup + sound if the user has that event on; otherwise the overlay's own small toast, as
// before. Player stats are filled into the card as soon as they're known.
async function notifyUser(kind, { title, player, text }, fallback, fallbackKind = 'info') {
  let id = null;
  try { id = await notifier.notify({ kind, title, text, player, stats: player && kind !== 'nickMatch' ? summaryFromRoster(player) : null }); } catch (_) {}
  if (!id) { toast(fallback, fallbackKind); return; }
  if (player && kind !== 'nickMatch' && !summaryFromRoster(player)) {
    playerSummary(player).then((s) => notifier.update(id, s)).catch(() => {}); // lookup failed: card keeps its placeholders
  }
}

function toSummary(name, s, sn, ur) {
  const tags = ((ur && ur.tags) || []).slice().sort((a, b) => (b.severity || 0) - (a.severity || 0))
    .map((t) => ({ label: t.label || String(t.type || '').slice(0, 6).toUpperCase(), color: t.color }));
  if (!s) return { name, tags, sniper: sn && sn.score ? sn : null };
  return { name, rank: s.rank, star: s.star, starColor: s.starColorHex, fkdr: s.fkdr, wlr: s.wlr, finals: s.finalKills, ws: s.winstreak, sniper: sn, tags };
}
function summaryFromRoster(name) {
  const row = roster && roster.players.get(String(name).toLowerCase());
  if (!row || row.loading) return null;
  if (row.nicked) return { name: row.name, nicked: true };
  return toSummary(row.name, row.stats, row.sniper, row.urchin);
}
// Not on the list (e.g. a DM from someone in another lobby): look them up directly. Same caches
// and rate limiter as the roster, so known players cost no extra requests.
async function playerSummary(name) {
  const r = await hypixel.resolveUuid(name);
  if (!r) return { name, nicked: true };
  const cfg = getConfig();
  const [player, ur] = await Promise.all([hypixel.fetchPlayer(r.id).catch(() => null), urchin.lookup(r.id, r.name).catch(() => null)]);
  const s = player ? statsLib.extract(player, hypixel.monthlyBaseline(r.id)) : null;
  const sn = statsLib.sniperScore(s, { weights: cfg.sniperWeights, tagSeverity: (ur && ur.severity) || 0 });
  return toSummary(player ? (player.displayname || r.name) : r.name, s, sn, ur);
}

// A blacklisted or high-sniper-score player just finished loading into your lobby. Once per player
// per lobby; never for you or your party.
const threatsAlerted = new Set();
// Threat/nick alerts are about scouting a Bedwars lobby; elsewhere (e.g. every Duels opponent) they'd
// just be noise, so by default they're Bedwars-only. Unknown game type = allowed.
function lobbyAlertsAllowed() {
  return (getConfig().notifications || {}).bedwarsOnly === false || !currentGametype || currentGametype === 'BEDWARS';
}
// Blacklisted (strong tag) or sniper score at/above the threshold; never you or your party.
function isThreat(row) {
  if (!row || row.source === 'SELF' || row.source === 'PARTY' || row.left || row.nicked) return false;
  const min = Number((getConfig().notifications || {}).threatMinSniper) || 70;
  return ((row.urchin && row.urchin.severity) || 0) >= 0.6 || ((row.sniper && row.sniper.score) || 0) >= min;
}
function checkThreat(row) {
  maybeDodge(row);
  if (!isThreat(row)) return;
  maybeWarnParty(row);
  if (!lobbyAlertsAllowed() || threatsAlerted.has(row.key)) return;
  const u = row.urchin || {};
  const flagged = (u.severity || 0) >= 0.6;
  const score = (row.sniper && row.sniper.score) || 0;
  threatsAlerted.add(row.key);
  const top = u.primary;
  const text = flagged && top ? `${top.label || 'Blacklisted'}${top.reason ? ': ' + top.reason : ''}` : `Sniper score ${score} (${row.sniper.label})`;
  notifyUser('threat', { title: 'Threat in your lobby', player: row.name, text }, `Threat: ${row.name}`, 'warn');
}

// A nicked player (no real Mojang account behind the name) just showed up in your lobby. Once per
// name per lobby. Not for you, your party, or any alias you listed in Settings -> General (add your
// own nicks there so you aren't alerted about yourself).
const nicksAlerted = new Set();
function checkNick(row) {
  if (!lobbyAlertsAllowed()) return;
  if (!row.nicked || row.source === 'SELF' || row.source === 'PARTY' || row.left || nicksAlerted.has(row.key)) return;
  const cfg = getConfig();
  const mine = [cfg.selfName, ...(cfg.reactNames || [])].map((n) => String(n || '').toLowerCase());
  if (mine.includes(row.key)) return;
  nicksAlerted.add(row.key);
  notifyUser('nicked', { title: 'Nicked player in your lobby', player: row.name, text: 'Stats and blacklist tags are hidden behind the nick.' }, `Nicked: ${row.name}`, 'warn');
}

// ---------------- chat warnings ----------------
// Two ways to warn about a flagged player (Settings -> Chat Warnings):
//  - party (auto, off by default): one /pc message per flagged player, only in the Bedwars pre-game
//    lobby, only when you're in a party, rate-limited and capped per lobby - never mid-match.
//  - public (Alt+W): types the warning into chat but does NOT send it; you read it and press Enter
//    yourself (or Esc). Tags can be wrong - a public accusation stays your decision.
// Text reaches the game via the clipboard (restored afterwards) and the helper's 'chat' command,
// which only acts on a focused Minecraft window. Messages come from chatWarn.js (100-char limit,
// illegal chat characters removed).
let chatHelper = null, chatBusy = false, lastPartyWarn = 0, publicWarnIndex = 0;
const partyWarned = new Set(), partyWarnQueue = [];
const cwCfg = () => getConfig().chatWarn || {};

// The player's own chat key from Minecraft's options.txt (next to the logs folder). LWJGL 2 key
// codes are keyboard scan codes. Falls back to T (20).
function chatKeyScan() {
  try {
    const opts = path.join(path.dirname(path.dirname(getConfig().logPath || '')), 'options.txt');
    const m = fs.readFileSync(opts, 'latin1').match(/^key_key\.chat:(-?\d+)/m);
    const code = m ? parseInt(m[1], 10) : 20;
    return code >= 1 && code <= 255 ? code : 20;
  } catch (_) { return 20; }
}

async function typeIntoChat(text, send) {
  if (process.platform !== 'win32') return 'unsupported';
  if (chatBusy || (nickRoller && nickRoller.running)) return 'busy';
  chatBusy = true;
  let saved = null;
  try {
    if (!chatHelper) chatHelper = new WinHelper(path.join(app.getPath('userData'), 'chat.frame'));
    await chatHelper.start();
    // Cheap check first, without touching your clipboard: while you're tabbed out (the usual reason
    // for a retry) the clipboard is never used at all.
    const fg = await chatHelper.foreground();
    if (!fg || !/^javaw?$/i.test(fg.process || '')) return 'notmc';
    saved = clipboard.readText();
    clipboard.writeText(text);
    return await chatHelper.chat(chatKeyScan(), send);
  } catch (e) {
    return 'error: ' + String(e.message || e);
  } finally {
    if (saved !== null) {
      // Give the game a moment to read the paste, then put your clipboard back - before the next
      // chat action can start (chatBusy is still held), so it can never save our text as "yours".
      await new Promise((r) => setTimeout(r, 300));
      if (clipboard.readText() === text) clipboard.writeText(saved);
    }
    chatBusy = false;
  }
}

function maybeWarnParty(row) {
  const c = cwCfg();
  if (!c.partyAuto || partyWarned.has(row.key)) return;
  if (currentGametype !== 'BEDWARS' || !currentMode || inMatch) return; // Bedwars pre-game lobby only
  if (![...roster.players.values()].some((r) => r.source === 'PARTY')) return; // no party, no /pc
  if (partyWarned.size >= (Number(c.maxPartyPerLobby) || 4)) return;
  partyWarned.add(row.key);
  partyWarnQueue.push(row.key);
}
// Drains the queue with a gap between messages; waits while Minecraft isn't focused, and drops
// everything once the match starts or you leave.
setInterval(async () => {
  if (chatBusy) return;
  if (pendingDodge) { await runDodge(); return; }
  if (!partyWarnQueue.length) return;
  if (inMatch || currentGametype !== 'BEDWARS' || !currentMode) { partyWarnQueue.length = 0; return; }
  if (Date.now() - lastPartyWarn < 3500) return;
  const row = roster && roster.players.get(partyWarnQueue[0]);
  if (!row) { partyWarnQueue.shift(); return; }
  const r = await typeIntoChat(chatWarn.compose(cwCfg().partyTemplate, row, { party: true }), true);
  if (r === 'ok') { partyWarnQueue.shift(); lastPartyWarn = Date.now(); }
  else if (!/^(notmc|notfg|keysheld|busy)$/.test(r)) { partyWarnQueue.shift(); console.warn('party warn failed:', r); }
}, 1000);

// ---- auto-dodge ----
// Leaves the Bedwars pre-game lobby (with your configured command, '/l bedwars' by default) the first
// time a player there crosses one of your limits. Once per lobby; never after the countdown's last
// second, never mid-match, never for you or your party. Off by default.
let pendingDodge = null, dodgedThisLobby = false;
const dodgeCfg = () => getConfig().autoDodge || {};
function inBedwarsPregame() { return currentGametype === 'BEDWARS' && !!currentMode && !inMatch && !matchStartTimer; }
function maybeDodge(row) {
  const c = dodgeCfg();
  if (!c.enabled || dodgedThisLobby || pendingDodge || !inBedwarsPregame()) return;
  const reason = chatWarn.dodgeReason(row, c);
  if (!reason) return;
  dodgedThisLobby = true;
  pendingDodge = { command: chatWarn.safeCommand(c.command), reason, since: Date.now() };
  notifyUser('dodge', { title: 'Leaving this lobby', player: row.name, text: reason + ' - running ' + pendingDodge.command }, 'Dodging: ' + reason, 'warn');
}
async function runDodge() {
  const d = pendingDodge;
  if (!inBedwarsPregame()) { pendingDodge = null; return; } // countdown over / already left: too late
  const r = await typeIntoChat(d.command, true);
  if (r === 'ok') pendingDodge = null;
  else if (!/^(notmc|notfg|keysheld|busy)$/.test(r)) { pendingDodge = null; toast('Auto-dodge failed (' + r + ')', 'warn'); }
  // notmc/notfg/keysheld: you're tabbed out or busy - retried every second while still in this lobby.
}

// Alt+W: the next flagged player in this lobby (cycles on repeated presses), typed into chat unsent.
async function publicWarn() {
  const threats = [...roster.players.values()].filter(isThreat)
    .sort((a, b) => (((b.urchin && b.urchin.severity) || 0) - ((a.urchin && a.urchin.severity) || 0)) || (((b.sniper && b.sniper.score) || 0) - ((a.sniper && a.sniper.score) || 0)));
  if (!threats.length) { toast('No flagged players in this lobby'); return; }
  const row = threats[publicWarnIndex++ % threats.length];
  const r = await typeIntoChat(chatWarn.compose(cwCfg().publicTemplate, row), false);
  if (r === 'notmc' || r === 'notfg') toast('Alt+W: focus Minecraft first');
  else if (r !== 'ok') toast('Could not type into chat (' + r + ')', 'warn');
}
let chatHotkeyBound = false;
function applyChatWarnHotkey() {
  const want = cwCfg().hotkey !== false && process.platform === 'win32';
  if (want && !chatHotkeyBound) chatHotkeyBound = globalShortcut.register('Alt+W', publicWarn);
  if (!want && chatHotkeyBound) { globalShortcut.unregister('Alt+W'); chatHotkeyBound = false; }
}

// ---------------- F11 fullscreen fix ----------------
// NVIDIA's OpenGL driver shows a window that exactly fills the monitor (Minecraft in F11) in an
// exclusive mode where Windows draws nothing on top - Solar's overlay and popups included. Once a
// second, if Minecraft is the foreground window and exactly fullscreen, it's made 1px taller: it
// still covers the whole screen, but Windows composes it normally again. Never touches focus. If the
// game keeps undoing it (>=5 times a minute), Solar stops fighting it.
let fsHelper = null, fsTimer = null, fsBusy = false, fsResizes = [], fsAnnounced = false;
function applyFullscreenFix() {
  const on = process.platform === 'win32' && getConfig().fullscreenFix !== false;
  if (on && !fsTimer) { fsHelper = new WinHelper(path.join(app.getPath('userData'), 'fsfix.frame')); fsTimer = setInterval(fullscreenTick, 1000); }
  if (!on && fsTimer) { clearInterval(fsTimer); fsTimer = null; if (fsHelper) fsHelper.stop(); fsHelper = null; }
}
async function fullscreenTick() {
  if (fsBusy || !fsHelper) return;
  fsBusy = true;
  try {
    await fsHelper.start();
    const now = Date.now();
    fsResizes = fsResizes.filter((t) => now - t < 60000);
    const r = await fsHelper.fullscreenFix(fsResizes.length < 5);
    if (r.resized) {
      fsResizes.push(now);
      if (!fsAnnounced) { fsAnnounced = true; toast('F11 fullscreen detected - adjusted so Solar can show over your game'); }
    }
  } catch (e) {
    console.warn('fullscreen fix unavailable:', e.message);
    clearInterval(fsTimer); fsTimer = null;
  } finally { fsBusy = false; }
}

// ---------------- in-game visibility check (Alt+T) ----------------
// Press it while in your game: shows a test popup, then samples the real window stacking order and
// the game window's fullscreen state for ~2.5s and appends the result to diagnostics.log in the
// app's data folder - hard evidence for why a popup can't be seen over a particular game setup.
function hwndOf(win) {
  try { const b = win.getNativeWindowHandle(); return b.length >= 8 ? b.readBigUInt64LE(0).toString() : String(b.readUInt32LE(0)); } catch (_) { return '0'; }
}
let visibilityCheckRunning = false;
async function visibilityCheck() {
  if (visibilityCheckRunning || process.platform !== 'win32') return;
  if (nickRoller && nickRoller.running) { toast('Stop the nick roller first'); return; }
  visibilityCheckRunning = true;
  const helper = nickRoller.d.helper;
  try {
    await notifier.notify({ kind: 'test', force: true, title: 'Test notification', text: 'Can you read this over your game? Checking how Windows stacks the windows right now…' });
    await helper.start();
    const samples = [];
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 200));
      samples.push({ t: i * 200, ...(await helper.diag(overlayWin ? hwndOf(overlayWin) : 0, notifier.window ? hwndOf(notifier.window) : 0)) });
    }
    const valid = samples.filter((s) => !s.error);
    const above = valid.filter((s) => s.popupZ > 0 && s.popupZ < s.fgZ).length;
    const first = valid[0] || {};
    const record = { at: new Date().toISOString(), version: app.getVersion(), samples };
    fs.appendFileSync(path.join(app.getPath('userData'), 'diagnostics.log'), JSON.stringify(record) + '\n');
    toast(`Visibility check: popup above "${first.fgProcess || '?'}" in ${above}/${valid.length} samples (fullscreen state ${first.fullscreenState}, game topmost: ${first.fgTopmost ? 'yes' : 'no'}). Saved to diagnostics.log`, above === valid.length ? 'info' : 'warn');
  } catch (e) {
    toast('Visibility check failed: ' + String(e.message || e), 'err');
  } finally {
    helper.stop();
    visibilityCheckRunning = false;
  }
}

// ---------------- nick roller ----------------
// The glyph shapes come from font/ascii.png inside the player's own Minecraft 1.8.9 jar - read at
// runtime, never bundled (it's Mojang's asset).
const FONT_ENTRY = 'assets/minecraft/textures/font/ascii.png';
let glyphCache = null, glyphJar = null;
function fontJarCandidates() {
  const custom = String((getConfig().nickRoller || {}).jarPath || '').trim();
  const mc = path.join(process.env.APPDATA || '', '.minecraft', 'versions');
  return [custom && /\.jar$/i.test(custom) ? custom : null, ...['1.8.9', '1.8.8', '1.8'].map((v) => path.join(mc, v, v + '.jar'))].filter(Boolean);
}
function loadGlyphs() {
  const jar = fontJarCandidates().find((p) => { try { return fs.statSync(p).isFile(); } catch (_) { return false; } });
  if (!jar) throw new Error('Minecraft 1.8.9 font not found. Launch 1.8.9 once with the official Minecraft launcher, or set the jar path in Settings → Nick Roller.');
  if (glyphCache && glyphJar === jar) return glyphCache;
  const buf = readEntry(jar, FONT_ENTRY);
  if (!buf) throw new Error('That jar has no Minecraft font in it: ' + path.basename(jar));
  glyphCache = loadFont(png.decode(buf)); glyphJar = jar;
  return glyphCache;
}

function setupNickRoller() {
  // Frames go through a file (a 1280x720 capture is ~3.7 MB - too big for a pipe per roll); it's a
  // crop of your game screen, so it lives in the app's own folder and is deleted after each run.
  const capPath = path.join(app.getPath('userData'), 'nickroll.frame');
  const helper = new WinHelper(capPath);
  nickRoller = new NickRoller({
    helper, loadGlyphs, getConfig,
    readFrame: (w, h) => {
      const data = fs.readFileSync(capPath);
      if (data.length !== w * h * 4) throw new Error('capture size mismatch');
      for (let i = 0; i < data.length; i += 4) { const b = data[i]; data[i] = data[i + 2]; data[i + 2] = b; } // BGRA -> RGBA
      return { width: w, height: h, data };
    },
  });
  nickRoller.on('status', (s) => {
    broadcast('nickRoller:status', s);
    // While rolling, the overlay must neither show up in the captures nor catch the clicks.
    if (overlayWin && s.running) { overlayWin.setContentProtection(true); overlayWin.setIgnoreMouseEvents(true, { forward: true }); }
  });
  nickRoller.on('done', ({ name, message, kind }) => {
    applyCapture(); applyClickThrough(); // back to the user's own settings
    helper.stop();
    fs.rm(capPath, { force: true }, () => {});
    if (kind === 'match') notifyUser('nickMatch', { title: 'Nick found', player: name, text: 'Click USE NAME to take it.' }, message, 'warn');
    else toast(message, kind === 'err' ? 'err' : 'info');
  });
}
function toggleNickRoller() {
  if (!nickRoller.running) toast('Nick roller started - move the mouse or press Alt+N to stop');
  nickRoller.toggle();
}

// ---------------- refresh loop ----------------
function applyRefreshTimer() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
  const s = Math.max(0, Number(getConfig().refreshSeconds) || 0);
  // Floor of 15s: anything faster just burns the Hypixel key's rate limit on unchanged stats.
  if (s > 0) refreshTimer = setInterval(() => roster.refreshAll(), Math.max(15, s) * 1000);
}

// ---------------- IPC ----------------
// Only our own windows, showing our own bundled pages, may call into the main process.
function isTrustedSender(e) {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || ![overlayWin, settingsWin, blacklistWin, splashWin, notifier && notifier.window].includes(win)) return false;
  try { return new URL(e.senderFrame.url).protocol === 'file:'; } catch (_) { return false; }
}
function handle(channel, fn) {
  ipcMain.handle(channel, (e, ...args) => {
    if (!isTrustedSender(e)) throw new Error('Blocked IPC from untrusted sender');
    return fn(e, ...args);
  });
}

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{32}$/i.test(v.replace(/-/g, ''));
// Strings only - anything else (objects with hostile toString, numbers, arrays) becomes ''.
const cleanText = (v, max) => (typeof v === 'string' ? v : '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

// shell.openExternal hands the URL to the OS, so it only ever gets https links to the handful of
// sites the app actually links to - never file:, custom protocols, or arbitrary hosts.
const EXTERNAL_HOSTS = new Set(['plancke.io', 'namemc.com', 'hypixel.net', 'developer.hypixel.net', 'urchin.gg', 'github.com']);
function openExternalSafe(url) {
  let u;
  try { u = new URL(String(url)); } catch (_) { return false; }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  if (!EXTERNAL_HOSTS.has(u.hostname.replace(/^www\./, ''))) return false;
  shell.openExternal(u.href);
  return true;
}

function registerIpc() {
  handle('config:get', (e) => configFor(BrowserWindow.fromWebContents(e.sender)));
  handle('config:reset', (e) => { config.reset(); afterConfigChange(null); broadcastConfig(); return configFor(BrowserWindow.fromWebContents(e.sender)); });
  handle('config:set', (e, patch) => {
    if (!isPlainObject(patch)) throw new Error('Invalid config patch');
    config.save(patch);
    afterConfigChange(patch);
    broadcastConfig();
    return configFor(BrowserWindow.fromWebContents(e.sender));
  });

  handle('roster:get', () => roster.list());
  handle('roster:add', (_e, name) => {
    const n = cleanText(name, 16);
    if (!validName(n)) return false;
    roster.addNames([n], 'MANUAL');
    return true;
  });
  handle('roster:remove', (_e, id) => {
    if (typeof id !== 'string') return false;
    if (isUuid(id)) roster.removeByUuid(id.replace(/-/g, '').toLowerCase());
    else if (validName(id)) roster.removeByName(id);
    return true;
  });
  handle('roster:clear', () => { roster.clear(); return true; });
  handle('roster:refresh', () => { roster.refreshAll(); return true; });

  handle('overlay:setClickThrough', (_e, v) => { config.save({ clickThrough: !!v }); applyClickThrough(); broadcastConfig(); return !!v; });
  // Act on the window that asked, not whichever happens to be focused - those can differ.
  handle('window:min', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
  handle('window:close', (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (w === overlayWin) app.quit(); else w?.close(); });
  handle('open:settings', () => openSettings());
  handle('open:blacklist', () => openBlacklist());
  handle('app:quit', () => app.quit());
  handle('app:relaunch', () => { app.relaunch(); app.quit(); });
  handle('app:info', () => ({ version: app.getVersion(), gpuAtLaunch }));
  handle('splash:done', () => { finishSplash(); return true; });

  handle('urchin:addTag', (_e, payload) => {
    if (!isPlainObject(payload) || !isUuid(payload.uuid)) throw new Error('Invalid UUID');
    const tag_type = cleanText(payload.tag_type, 40);
    const reason = cleanText(payload.reason, 500);
    if (!tag_type || !reason) throw new Error('Tag type and reason are required');
    return urchin.addTag({ uuid: payload.uuid, tag_type, reason, hide_username: !!payload.hide_username, overwrite: !!payload.overwrite });
  });
  handle('urchin:addLocal', (_e, uuid, tag) => {
    if (!isUuid(uuid) || !isPlainObject(tag)) return false;
    urchin.addLocalTag(uuid, { tag_type: cleanText(tag.tag_type, 40) || 'info', reason: cleanText(tag.reason, 200) || 'flagged' });
    roster.refreshAll();
    return true;
  });
  handle('watchlist:add', (_e, name, reason) => {
    const n = cleanText(name, 16);
    if (!validName(n)) return false;
    return watchlistAdd(n, cleanText(reason, 80) || 'manual', 'MANUAL');
  });

  // Accepts a username or a UUID (with or without dashes).
  handle('lookup:name', async (_e, query) => {
    const q = cleanText(query, 40);
    let r;
    try { r = isUuid(q) ? await hypixel.resolveName(q) : (validName(q) ? await hypixel.resolveUuid(q) : null); }
    catch (e) { return { ok: false, error: 'lookup failed (' + String(e.message || e) + ') - try again' }; }
    if (!r) return { ok: false, error: 'not found (nicked or invalid)' };
    const ur = await urchin.lookup(r.id, r.name).catch(() => null);
    return { ok: true, uuid: r.id, name: r.name, urchin: ur };
  });

  handle('key:test', async () => {
    // /v2/key used to be how you checked a key, but Hypixel removed it - it now 404s
    // ("Unknown endpoint") even for a perfectly valid key. Rate-limit info comes back as
    // headers on any real call now, so ping a tiny no-target endpoint instead and read those.
    try {
      const r = await fetch('https://api.hypixel.net/v2/punishmentstats', { headers: { 'API-Key': getConfig().hypixelKey }, signal: AbortSignal.timeout(10000) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.success) {
        const limit = r.headers.get('ratelimit-limit');
        return { ok: true, record: { limit: limit ? Number(limit) : null } };
      }
      return { ok: false, error: j.cause || ('HTTP ' + r.status) };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  handle('log:pick', async (e) => {
    const parent = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(parent, { title: 'Select latest.log', properties: ['openFile'], filters: [{ name: 'Log', extensions: ['log', 'txt'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    config.save({ logPath: r.filePaths[0] }); startWatcher(); broadcastConfig();
    return r.filePaths[0];
  });

  // Settings' live preview: validates a rule list and checks one name against it, using the exact
  // same engine the overlay uses.
  handle('nameRules:check', (_e, rules, name) => {
    const compiled = nameRules.compile(Array.isArray(rules) ? rules.map((r) => cleanText(r, nameRules.MAX_RULE_LENGTH + 1)) : []);
    return { valid: compiled.rules.length, errors: compiled.errors, hits: nameRules.match(compiled, cleanText(name, 32)) };
  });

  handle('notify:preview', () => { notifier.preview(); return true; });
  handle('notify:idle', () => { notifier.idle(); return true; });

  handle('nickRoller:status', () => nickRoller.state);
  handle('nickRoller:stop', () => { nickRoller.stop('stopped from the app'); return true; });
  // Settings' preview: are the requirements usable, would this name pass, and can we find the font?
  handle('nickRoller:check', (_e, name) => {
    const cfg = getConfig(), rc = cfg.nickRoller || {};
    const req = buildRequirements(rc, rc.useNameWatch ? ((cfg.nameWatch || {}).rules || []) : []);
    const n = cleanText(name, 32);
    let font;
    try { loadGlyphs(); font = { ok: true, jar: glyphJar }; } catch (e) { font = { ok: false, error: e.message }; }
    return { empty: req.empty, errors: req.errors, result: n ? req.test(n) : null, font, platform: process.platform };
  });

  // Settings preview of both chat templates against a sample flagged player.
  handle('chatWarn:safeCommand', (_e, cmd) => chatWarn.safeCommand(cleanText(cmd, 80)));
  handle('chatWarn:preview', (_e, party, pub) => {
    const sample = { name: 'Sheplock', urchin: { tags: [{ type: 'Blatant Cheater', reason: 'blatant legitscaff, killaura, reach - reported by 4 people in the last week', severity: 1 }] }, sniper: { score: 93 }, stats: { fkdr: 11.4, star: 912 } };
    return { party: chatWarn.compose(cleanText(party, 300), sample, { party: true }), public: chatWarn.compose(cleanText(pub, 300), sample), chatKey: chatKeyScan() };
  });

  handle('link:open', (_e, url) => openExternalSafe(url));
  handle('log:getStatus', () => lastLogStatus);
}

// Name Watch rules are compiled once per change, not per player.
function applyNameWatch() {
  const nw = getConfig().nameWatch || {};
  const compiled = nw.enabled === false ? null : nameRules.compile(nw.rules);
  roster.setMatcher(compiled ? (name) => nameRules.match(compiled, name) : null);
}

function applySelf() { const cfg = getConfig(); roster.setSelf(cfg.selfName, cfg.hideSelf); }

// patch === null means "everything may have changed" (a reset).
function afterConfigChange(patch) {
  const all = patch == null;
  const has = (k) => all || patch[k] !== undefined;
  if (overlayWin) {
    if (has('alwaysOnTop')) applyAlwaysOnTop();
    if (has('hideFromCapture')) applyCapture();
    if (has('clickThrough')) applyClickThrough();
    if (has('window')) overlayWin.setOpacity(getConfig().window.opacity ?? 0.94);
  }
  if (has('logPath') || has('logEnabled') || has('selfName') || has('reactNames')) startWatcher();
  if (has('selfName') || has('hideSelf')) applySelf();
  if (has('refreshSeconds')) applyRefreshTimer();
  if (has('overlayMode')) { overlayOverride = null; applyOverlayVisibility(); }
  if (has('fullscreenFix')) applyFullscreenFix();
  if (has('chatWarn')) applyChatWarnHotkey();
  if (has('nameWatch')) applyNameWatch();
}

// ---------------- tray + shortcuts ----------------
function toggleClickThrough() {
  config.save({ clickThrough: !getConfig().clickThrough });
  applyClickThrough();
  broadcastConfig();
  toast('Click-through ' + (getConfig().clickThrough ? 'ON' : 'OFF'));
}
function buildTray() {
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'icon.png'));
    tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
    tray.setToolTip('Solar Overlay');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show / Hide Overlay', click: toggleOverlay },
      { label: 'Settings', click: openSettings },
      { label: 'Blacklist Admin', click: openBlacklist },
      { type: 'separator' },
      { label: 'Toggle Click-Through', click: toggleClickThrough },
      { label: 'Quit', click: () => app.quit() },
    ]));
    tray.on('double-click', toggleOverlay);
  } catch (_) {}
}
function toggleOverlay() {
  if (!overlayWin) { createOverlay(); overlayWin.showInactive(); return; }
  overlayOverride = !overlayWin.isVisible();
  applyOverlayVisibility();
}

function registerShortcuts() {
  const bind = (accel, fn) => { if (!globalShortcut.register(accel, fn)) console.warn('shortcut unavailable (in use by another app):', accel); };
  bind('Alt+B', toggleOverlay);
  bind('Alt+X', toggleClickThrough);
  bind('Alt+C', () => roster.clear());
  bind('Alt+S', openSettings);
  bind('Alt+N', toggleNickRoller);
  bind('Alt+T', visibilityCheck);
  applyChatWarnHotkey();
}

// ---------------- security baseline ----------------
function lockDown() {
  // No page may open new windows, navigate away from the file it was loaded with, or embed
  // <webview>s - so even an injected link or script can't pull remote content into a window that
  // has the preload bridge.
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => { openExternalSafe(url); return { action: 'deny' }; });
    contents.on('will-navigate', (ev, url) => { if (url !== contents.getURL()) ev.preventDefault(); });
    contents.on('will-redirect', (ev) => ev.preventDefault());
    contents.on('will-attach-webview', (ev) => ev.preventDefault());
  });
  // Deny every browser permission (camera, mic, geolocation, notifications, ...) except writing
  // plain text to the clipboard, which "Copy username" uses.
  const allowed = new Set(['clipboard-sanitized-write']);
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(allowed.has(perm)));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => allowed.has(perm));
}

// ---------------- boot ----------------
// One instance only: a second copy would fight the first over config.json, the log file, and the
// global shortcuts. Launching again just brings the running overlay forward.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (overlayWin) wake(overlayWin); });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null); // no menu bar on this app, and it's what binds F11 -> fullscreen by default
    lockDown();
    hypixel = new Hypixel(getConfig);
    urchin = new Urchin(getConfig);
    roster = new Roster(hypixel, urchin, getConfig);
    watcher = new LogWatcher();

    roster.on('update', (list) => broadcast('roster:update', list));
    roster.on('nameMatch', (row) => {
      if ((getConfig().nameWatch || {}).notify === false) return;
      notifyUser('nameWatch', { title: 'Name Watch', player: row.name, text: 'Matches ' + row.nameMatch.join(', ') }, `Name Watch: ${row.name} matches ${row.nameMatch.join(', ')}`, 'warn');
    });
    roster.on('loaded', checkThreat);
    roster.on('loaded', checkNick);
    wireWatcher();
    notifier = new Notifier({ getConfig, webPreferences: SECURE_PREFS, anchorWindow: () => overlayWin });
    setupNickRoller();
    applyFullscreenFix();
    registerIpc();
    createSplash();
    createOverlay(); // stays hidden (show:false) until the splash reports done, see finishSplash()
    buildTray();
    registerShortcuts();
    startWatcher();
    applyRefreshTimer();
    applyNameWatch();
    applySelf(); // your own IGN, if configured, is in the list from the moment the app starts
    // Stay-on-top watchdog: a borderless-fullscreen game (F11) jumps above all topmost windows each
    // time it's activated, hiding the overlay and popups behind it. Re-raise whatever of ours is
    // visible, never activating it (see raiseInactive), so the game keeps focus.
    // Popups are re-raised every 250ms while one is on screen (they're short-lived and must be seen);
    // the overlay every 1.5s.
    let tick = 0;
    setInterval(() => {
      const nw = notifier && notifier.window;
      if (nw && !nw.isDestroyed() && nw.isVisible()) raiseInactive(nw);
      if (++tick % 6) return;
      if (overlayWin && !overlayWin.isDestroyed() && overlayWin.isVisible() && getConfig().alwaysOnTop) raiseInactive(overlayWin);
    }, 250);

    app.on('activate', () => { if (!overlayWin) { createOverlay(); overlayWin.show(); } });
  });

  app.on('window-all-closed', () => {}); // stay alive in tray
  app.on('will-quit', () => { globalShortcut.unregisterAll(); if (nickRoller) { nickRoller.stop('app closing'); nickRoller.d.helper.stop(); } if (notifier) notifier.destroy(); if (fsHelper) fsHelper.stop(); if (chatHelper) chatHelper.stop(); });
}
