'use strict';
const { app, BrowserWindow, ipcMain, globalShortcut, dialog, Tray, Menu, nativeImage, shell, session } = require('electron');
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
const { Notifier } = require('./notifications');
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

// A short, one-time-per-launch title card. It owns its own ~2.6s timing (see splash.js) and
// reports back over IPC when it's done rather than main.js guessing a delay. Non-focusable and
// shown inactive: launching the app while in a game must never pull focus out of it.
function createSplash() {
  splashWin = new BrowserWindow({
    width: 420, height: 260, frame: false, transparent: true, resizable: false, movable: false,
    fullscreenable: false, alwaysOnTop: true, skipTaskbar: true, backgroundColor: '#00000000',
    hasShadow: false, show: false, center: true, focusable: false,
    icon: ICON,
    webPreferences: SECURE_PREFS,
  });
  splashWin.once('ready-to-show', () => splashWin.showInactive());
  splashWin.loadFile(path.join(__dirname, '..', 'renderer', 'splash', 'splash.html'));
  splashWin.on('closed', () => { splashWin = null; });
  // Safety net: if the splash page ever fails to report in, don't leave the overlay hidden forever.
  setTimeout(finishSplash, 12000);
}
function finishSplash() {
  if (splashWin && !splashWin.isDestroyed()) splashWin.close();
  if (overlayWin && !overlayWin.isDestroyed() && !overlayWin.isVisible()) overlayWin.showInactive();
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
function applyClickThrough() {
  if (!overlayWin) return;
  overlayWin.setIgnoreMouseEvents(!!getConfig().clickThrough, { forward: true });
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
  watcher.on('serverChange', (info) => {
    // undefined means "changed servers, but we don't actually know which one" (the plain-text
    // fallback patterns can't tell) - leave currentServer alone rather than guessing. Any real
    // string (including "limbo") is an actual answer from the JSON status blob and overwrites it.
    if (info && info.server !== undefined) currentServer = info.server;
    threatsAlerted.clear(); // new lobby: a sniper you meet again deserves a fresh heads-up
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
    playerSummary(player).then((s) => notifier.update(id, s)).catch(() => notifier.update(id, { name: player, nicked: true }));
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
function checkThreat(row) {
  if (row.source === 'SELF' || row.source === 'PARTY' || row.left || threatsAlerted.has(row.key)) return;
  const min = Number((getConfig().notifications || {}).threatMinSniper) || 70;
  const u = row.urchin || {};
  const flagged = (u.severity || 0) >= 0.6;
  const score = (row.sniper && row.sniper.score) || 0;
  if (!flagged && score < min) return;
  threatsAlerted.add(row.key);
  const top = u.primary;
  const text = flagged && top ? `${top.label || 'Blacklisted'}${top.reason ? ': ' + top.reason : ''}` : `Sniper score ${score} (${row.sniper.label})`;
  notifyUser('threat', { title: 'Threat in your lobby', player: row.name, text }, `Threat: ${row.name}`, 'warn');
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

  handle('overlay:setClickThrough', (_e, v) => { config.save({ clickThrough: !!v }); applyClickThrough(); return !!v; });
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
    const r = isUuid(q) ? await hypixel.resolveName(q) : (validName(q) ? await hypixel.resolveUuid(q) : null);
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
function toggleOverlay() { if (!overlayWin) { createOverlay(); overlayWin.show(); return; } overlayWin.isVisible() ? overlayWin.hide() : overlayWin.showInactive(); }

function registerShortcuts() {
  const bind = (accel, fn) => { if (!globalShortcut.register(accel, fn)) console.warn('shortcut unavailable (in use by another app):', accel); };
  bind('Alt+B', toggleOverlay);
  bind('Alt+X', toggleClickThrough);
  bind('Alt+C', () => roster.clear());
  bind('Alt+S', openSettings);
  bind('Alt+N', toggleNickRoller);
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
    wireWatcher();
    notifier = new Notifier({ getConfig, webPreferences: SECURE_PREFS, anchorWindow: () => overlayWin });
    setupNickRoller();
    registerIpc();
    createSplash();
    createOverlay(); // stays hidden (show:false) until the splash reports done, see finishSplash()
    buildTray();
    registerShortcuts();
    startWatcher();
    applyRefreshTimer();
    applyNameWatch();
    applySelf(); // your own IGN, if configured, is in the list from the moment the app starts

    app.on('activate', () => { if (!overlayWin) { createOverlay(); overlayWin.show(); } });
  });

  app.on('window-all-closed', () => {}); // stay alive in tray
  app.on('will-quit', () => { globalShortcut.unregisterAll(); if (nickRoller) { nickRoller.stop('app closing'); nickRoller.d.helper.stop(); } if (notifier) notifier.destroy(); });
}
