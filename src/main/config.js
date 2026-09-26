'use strict';
// Config lives here and gets persisted to <userData>/config.json — the Settings
// window is really just a form bound to this one object.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app, safeStorage } = require('electron');

// Secrets are kept OUT of version control (see .gitignore + secrets.example.js).
// Copy secrets.example.js -> secrets.js and fill in your keys. Missing file = empty
// defaults, and you can still paste keys in Settings (they save to userData, not the repo).
let secrets = {};
try { secrets = require('./secrets'); } catch (_) {}

const CONFIG_VERSION = 2;

function guessLogPath() {
  // Sensible Windows defaults. User can override in Settings.
  const home = os.homedir();
  const lunarProfiles = path.join(home, '.lunarclient', 'profiles');

  // Lunar Client keeps one log dir per game-version profile, e.g.
  // .lunarclient\profiles\1.8\logs\latest.log — 1.8 is where Bedwars lives, so try it first.
  for (const v of ['1.8', '1.7', '1.21', '1.16', '1.12']) {
    const p = path.join(lunarProfiles, v, 'logs', 'latest.log');
    try { if (fs.existsSync(p)) return p; } catch (_) {}
  }
  // Fall back to scanning whatever profiles actually exist on this machine.
  try {
    for (const v of fs.readdirSync(lunarProfiles)) {
      const p = path.join(lunarProfiles, v, 'logs', 'latest.log');
      try { if (fs.existsSync(p)) return p; } catch (_) {}
    }
  } catch (_) {}

  // Modrinth App keeps one log dir per instance too, under an arbitrary instance name -
  // e.g. %APPDATA%\ModrinthApp\profiles\<name>\logs\latest.log - same scan idea as Lunar above.
  try {
    const modrinthProfiles = path.join(process.env.APPDATA || home, 'ModrinthApp', 'profiles');
    for (const name of fs.readdirSync(modrinthProfiles)) {
      const p = path.join(modrinthProfiles, name, 'logs', 'latest.log');
      try { if (fs.existsSync(p)) return p; } catch (_) {}
    }
  } catch (_) {}

  const candidates = [
    path.join(lunarProfiles, '1.8', 'logs', 'latest.log'),
    // Vanilla / MultiMC-style
    path.join(process.env.APPDATA || home, '.minecraft', 'logs', 'latest.log'),
    // Badlion
    path.join(process.env.APPDATA || home, '.minecraft', 'logs', 'blclient', 'minecraft', 'latest.log'),
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch (_) {}
  }
  return candidates[0];
}

// The full set of built-in columns. Every one of these is just as removable/re-addable
// as a custom column now — there's no "always shown" column anymore, Player included.
const ALL_COLUMNS = [
  { key: 'source',   label: 'Source',    width: 44 },
  { key: 'tag',      label: 'Tag',       width: 46 },
  { key: 'star',     label: 'Lvl',       width: 58 },
  { key: 'name',     label: 'Player',    width: 130 },
  { key: 'fkdr',     label: 'FKDR',      width: 62 },
  { key: 'wlr',      label: 'WLR',       width: 58 },
  { key: 'finals',   label: 'F.Kills',   width: 70 },
  { key: 'wins',     label: 'Wins',      width: 62 },
  { key: 'ws',       label: 'WS',        width: 46 },
  { key: 'hws',      label: 'Peak WS',   width: 60 },
  { key: 'mfkdr',    label: 'M.FKDR',    width: 64 },
  { key: 'sniper',   label: 'Sniper',    width: 66 },
  { key: 'lastseen', label: 'Last Login',width: 92 },
  { key: 'bl',       label: 'BL',        width: 40 },
];

function defaults() {
  return {
    version: CONFIG_VERSION,

    // ---- API keys (loaded from gitignored secrets.js; also editable in Settings) ----
    hypixelKey: secrets.hypixelKey || '',
    // Urchin: fully-configurable endpoint. {id} {uuid} {name} {key} {sources} placeholders
    // are substituted. Cubelify-style {{id}} double braces also work. The key comes from urchinKey.
    urchinKey: secrets.urchinKey || '',
    urchinEndpoint: 'https://api.urchin.gg/v3/cubelify?uuid={id}&key={key}&name={name}&sources={sources}',
    urchinAdminKey: secrets.urchinAdminKey || '', // required only for the "Add to blacklist" admin tab
    urchinSources: 'GAME,PARTY,PARTY_INVITES,CHAT,CHAT_MENTIONS,MANUAL,ME',
    urchinAdminBase: 'https://api.urchin.gg/v3',
    // Urchin ships on by default (it's listed as a built-in entry in Settings -> Connections)
    // but the user is free to switch it off if they'd rather run their own endpoints only.
    urchinEnabled: true,
    // Extra blacklist/tag APIs beyond the built-in Urchin one, set up in Settings -> Connections.
    // Each entry: { id, name, endpoint, key, enabled }, same {id}{uuid}{name}{key}{sources} placeholders as urchinEndpoint.
    connections: [],

    // ---- Identity ----
    selfName: '',   // your IGN — the name the overlay reacts to
    reactNames: [], // extra aliases the overlay should react to

    // ---- Log detection ----
    logEnabled: true,
    logPath: guessLogPath(),
    clearOnServerChange: true,
    clearOnLobbyJoin: true,
    // On by default - this used to be opt-in because it couldn't tell the main hub (or Bedwars'
    // own shared matchmaking queue) apart from your actual match, so it added random unrelated
    // chatter right along with real lobby-mates. It's now scoped to your actual match instance
    // specifically (see inBedwarsMatch() in main.js), which is exactly the "who's actually in my
    // game" signal the rest of this app is built around - same reasoning as the triggers below.
    trackChatSpeakers: true,

    // ---- Auto-blacklist / watchlist triggers ----
    // On by default — this is the whole point of the overlay (auto-track anyone who
    // interacts with you), and a new user shouldn't have to dig into Settings to get
    // basic "someone said my name" detection working. Still fully toggleable per-trigger.
    triggers: {
      onNameInChat: true,
      onPartyJoin: true,
      onPartyInvite: true,
      onDirectMessage: true,
      onFriendRequest: true,
    },
    autoTagType: 'info',
    watchlist: {}, // { uuid: {reason, added_on, name} } local-only soft flags

    // ---- Refresh / performance ----
    refreshSeconds: 0,  // 0 = only fetch on detection (lightweight)
    concurrency: 4,
    cacheMinutes: 3,
    // Off by default: with GPU acceleration on, Chromium runs its own D3D/GL compositor for this
    // transparent, always-on-top window right on top of Minecraft's OpenGL surface, which some
    // drivers answer with GL_INVALID_OPERATION (1282) spam in the game. A small table renders just
    // as smoothly on the CPU, and this keeps the overlay entirely out of the game's GPU pipeline.
    // Read before app 'ready' (see readEarly), so changing it needs a restart.
    gpuAcceleration: false,

    // ---- Overlay window ----
    // Wide enough to fit every default column (now with per-column widths actually applied,
    // see overlay.js) without squeezing the Player name down to a sliver.
    window: { x: 60, y: 60, width: 900, height: 420, opacity: 0.94 },
    alwaysOnTop: true,
    hideFromCapture: true, // setContentProtection -> invisible to OBS/Discord/screenshots
    clickThrough: false,
    lockPosition: false,
    fontSize: 13,
    rowHeight: 22,
    compact: false,

    // ---- Columns ----
    columns: ALL_COLUMNS.map((c, i) => ({ key: c.key, visible: true, order: i })),
    // User-defined columns pulling a stat off either the raw Hypixel player object or a
    // Connection's raw response, e.g. { key: 'custom:abc', label: 'Beds Broken',
    // source: 'hypixel', path: 'stats.Bedwars.beds_broken_bedwars' }. source is 'hypixel'
    // (default) or a connection id ('urchin' or a user Connection's id).
    customColumns: [],
    // Per-column overrides that rewire a BUILT-IN column (by key) to a Connection instead
    // of its normal computed/Hypixel value — e.g. { tag: { source: 'myConnId' } } restricts
    // the Tag/BL columns to just that connection's tags, or { mfkdr: { source: 'myConnId',
    // path: 'stats.monthlyFkdr' } } pulls M.FKDR from that connection's response instead.
    columnSources: {},
    sortBy: 'sniper',
    sortDir: 'desc',
    hideNicked: false,
    hideSelf: false,

    // ---- Theme ----
    theme: {
      name: 'midnight',
      bg: '#0d1117',
      headerBg: '#161b22',
      text: '#e6edf3',
      accent: '#58a6ff',
      grid: '#21262d',
    },

    // ---- Sniper / threat score weights (transparent & tunable) ----
    // FKDR, blacklist tags, and alt/smurf-account signals are weighted heavily by default —
    // those are the strongest "this person is a real threat" indicators. The rest still
    // contribute but matter less on their own.
    sniperWeights: {
      fkdr: 40,
      star: 8,
      wlr: 8,
      winstreak: 6,
      monthlyTrend: 10,
      accountAge: 20,
      recentLogin: 4,
      tags: 26,
      freshAccount: 14, // low star / freshly-joined account that's already good -> classic smurf signal
    },

    // ---- Name Watch ----
    // Your own list of name rules (plain text or /regex/flags, one per entry), checked against
    // every player on the overlay - see nameRules.js. Matches get highlighted, optionally toasted.
    nameWatch: { enabled: true, notify: true, rules: [] },

    // ---- Notifications (corner popups + sounds; see notifications.js) ----
    // Popups never take focus from the game. Each event can show a popup and/or play a sound.
    notifications: {
      enabled: true, position: 'bottom-right', durationSec: 7, sound: true, volume: 0.6, threatMinSniper: 70, startupSound: true,
      events: {
        nickMatch: { popup: true, sound: true }, mention: { popup: true, sound: true }, dm: { popup: true, sound: true },
        partyInvite: { popup: true, sound: true }, friendRequest: { popup: true, sound: false },
        threat: { popup: true, sound: true }, nameWatch: { popup: true, sound: true },
      },
    },

    // ---- Nick roller (Alt+N with Hypixel's random-name book open; see nickRoller.js) ----
    // A rolled name is accepted when it passes every enabled check AND matches at least one rule
    // (if any rules are set). jarPath optionally points at a Minecraft 1.8.9 jar for the font.
    nickRoller: { rules: [], useNameWatch: false, minLength: 0, maxLength: 16, noDigits: false, noUnderscore: false, delayMinMs: 1200, delayMaxMs: 2200, humanMouse: true, moveMinMs: 180, moveMaxMs: 420, randomClickPoint: true, maxRolls: 300, jarPath: '' },

    // ---- Row highlight ----
    // Flags a whole row when one stat clears a threshold. Any column key works (built-in,
    // custom, or catalog), not just fkdr — just what most people care about by default.
    highlightEnabled: true,
    highlightStat: 'fkdr',
    highlightThreshold: 8,
  };
}

let cache = null;
let filePath = null;

function file() {
  if (!filePath) filePath = path.join(app.getPath('userData'), 'config.json');
  return filePath;
}

// Keys that would let a crafted patch (from a renderer, or a hand-edited config.json) reach an
// object's prototype through deepMerge - dropped everywhere, at any depth.
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
function sanitize(v, depth = 0) {
  if (depth > 12) return undefined;
  if (Array.isArray(v)) return v.map((x) => sanitize(x, depth + 1));
  if (!v || typeof v !== 'object') return v;
  const out = {};
  for (const k of Object.keys(v)) if (!FORBIDDEN_KEYS.has(k)) out[k] = sanitize(v[k], depth + 1);
  return out;
}

function deepMerge(base, over) {
  if (Array.isArray(base) || Array.isArray(over)) return over === undefined ? base : over;
  if (typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    if (FORBIDDEN_KEYS.has(k)) continue;
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && typeof base[k] === 'object') {
      out[k] = deepMerge(base[k], over[k]);
    } else {
      out[k] = over[k];
    }
  }
  return out;
}

// ---- API keys at rest ----
// Keys are sealed with Electron's safeStorage (DPAPI on Windows - tied to this Windows user
// account) before config.json hits disk, so the file alone is useless if it gets copied, synced,
// or attached to a bug report. In memory they stay plaintext; that's what the API calls need.
// If encryption isn't available on this machine they're written as before rather than lost.
const ENC_PREFIX = 'enc:v1:';
const SECRET_KEYS = ['hypixelKey', 'urchinKey', 'urchinAdminKey'];
// What non-Settings windows see in place of a real key: enough to know "one is set", nothing more.
const REDACTED = '••••••••';

function canEncrypt() {
  try { return !!(safeStorage && safeStorage.isEncryptionAvailable()); } catch (_) { return false; }
}
function sealSecret(v) {
  if (typeof v !== 'string' || !v || v.startsWith(ENC_PREFIX) || !canEncrypt()) return v;
  try { return ENC_PREFIX + safeStorage.encryptString(v).toString('base64'); } catch (_) { return v; }
}
function openSecret(v) {
  if (typeof v !== 'string' || !v.startsWith(ENC_PREFIX)) return v;
  // Undecryptable (config copied from another PC/user): the key is gone either way - the user
  // just re-enters it in Settings, same as a fresh install.
  try { return safeStorage.decryptString(Buffer.from(v.slice(ENC_PREFIX.length), 'base64')); } catch (_) { return ''; }
}
function mapSecrets(obj, fn) {
  const out = { ...obj };
  for (const k of SECRET_KEYS) if (k in out) out[k] = fn(out[k]);
  if (Array.isArray(out.connections)) {
    out.connections = out.connections.map((c) => (c && typeof c === 'object' && 'key' in c ? { ...c, key: fn(c.key) } : c));
  }
  return out;
}
function redact(cfg) { return mapSecrets(cfg, (v) => (v ? REDACTED : '')); }

// A renderer that only ever saw redacted keys must never be able to write the placeholder back
// over the real key - drop those fields (and restore connection keys by id) before merging.
function dropRedacted(patch, current) {
  const out = { ...patch };
  for (const k of SECRET_KEYS) if (out[k] === REDACTED) delete out[k];
  if (Array.isArray(out.connections)) {
    const byId = new Map((current.connections || []).map((c) => [c && c.id, c]));
    out.connections = out.connections.map((c) => (c && c.key === REDACTED ? { ...c, key: (byId.get(c.id) || {}).key || '' } : c));
  }
  return out;
}

// ---- migrations for configs saved by older versions ----
function migrate(saved) {
  const s = { ...saved };
  if ((s.version || 1) < 2) {
    // v2 dropped the "final-killed you" trigger: its kill-feed match fired on every final kill in
    // the lobby, not just yours, so it mislabelled players (including you). Remove the toggle and
    // the bogus watchlist flags it left behind.
    if (s.triggers && typeof s.triggers === 'object') { s.triggers = { ...s.triggers }; delete s.triggers.onKilledYou; }
    if (s.watchlist && typeof s.watchlist === 'object') {
      s.watchlist = Object.fromEntries(Object.entries(s.watchlist).filter(([, v]) => !(v && v.reason === 'final-killed you')));
    }
  }
  s.version = CONFIG_VERSION;
  return s;
}

function writeFile() {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    // Write-then-rename so a crash mid-write can't leave a truncated config.json behind.
    const tmp = file() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(mapSecrets(cache, sealSecret), null, 2));
    fs.renameSync(tmp, file());
  } catch (e) { console.error('config save failed', e); }
}

// Must only run after app 'ready' - safeStorage can't decrypt before then.
function load() {
  if (cache) return cache;
  let saved = null;
  try { saved = sanitize(JSON.parse(fs.readFileSync(file(), 'utf8'))); } catch (_) {}
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = null;
  let hasPlainKey = false;
  if (saved) mapSecrets(saved, (v) => { if (typeof v === 'string' && v && !v.startsWith(ENC_PREFIX)) hasPlainKey = true; return v; });
  const outdated = !!saved && (saved.version || 1) < CONFIG_VERSION;
  cache = deepMerge(defaults(), saved ? migrate(mapSecrets(saved, openSecret)) : {});
  // Re-save once so plaintext keys from older versions get encrypted and migrations persist.
  if (outdated || (hasPlainKey && canEncrypt())) writeFile();
  return cache;
}

// Reads one top-level value straight off disk, bypassing the cache and decryption - for the few
// settings (GPU acceleration) that have to be decided before app 'ready'.
function readEarly(key, fallback) {
  try {
    const j = JSON.parse(fs.readFileSync(file(), 'utf8'));
    return Object.prototype.hasOwnProperty.call(j, key) ? j[key] : fallback;
  } catch (_) { return fallback; }
}

function save(patch) {
  const current = load();
  cache = deepMerge(current, dropRedacted(sanitize(patch || {}) || {}, current));
  writeFile();
  return cache;
}

function reset() {
  cache = defaults();
  writeFile();
  return cache;
}

module.exports = { load, save, reset, defaults, redact, readEarly, ALL_COLUMNS, REDACTED, CONFIG_VERSION, _internal: { migrate, sanitize, sealSecret, openSecret } };
