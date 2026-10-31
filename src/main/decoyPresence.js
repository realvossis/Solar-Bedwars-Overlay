'use strict';
// Discord decoy: a Rich Presence that looks exactly like Lunar Client's own - same Discord app,
// same images, same wording - but only ever shows Bed Wars games you are NOT in. A sniper who
// reads your Discord status queues into the wrong mode/map at exactly the moment you queue.
//
// Everything below was read from Lunar's own launcher (resources/app.asar, the 'discord' module)
// and checked against Discord's public app/asset API, not guessed:
//   client id 671636579701358592 = the "Lunar Client" Discord app
//   in a game:   details "{playerState} {gameName} on {server}"  -> "Playing Bed Wars on Hypixel"
//                state   "{gameVariantName} on {mapName}"        -> "4v4v4v4 on Shipwreck"
//   no game info (lobby): details "Playing {server}", state "On Minecraft {version}"
//   large image = the server's logo URL from Lunar's ServerMappings, small image = "logo-blue"
//   timestamps.start = when the game was launched (not when the match started)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const LUNAR_CLIENT_ID = '671636579701358592';
const HYPIXEL_LOGO = 'https://servermappings.lunarclientcdn.com/logos/hypixel.png';

// Map pools as in rotation on 2026-09-28 (hypixel.net "[Tool] Bed Wars Map List + Availability
// Data" tracker). Hypixel rotates weekly, so refresh these now and then - an out-of-rotation map
// is the one thing a sharp sniper could notice.
const EIGHT_TEAM = ['Acropolis', 'Ambush', 'Ashfire', 'Babylon', 'Bio-Hazard', 'Cascade', 'Crogorm', 'Dockyard', 'Dragonstar', 'Gateway', 'Glacier', 'Highland Peaks', 'Impere', 'Ironclad', 'Lighthouse', 'Lightstone', 'Orbit', 'Orchestra', 'Pernicious', 'Playground', 'Rooftop', 'Sanctum', 'Scorched Sands', 'Sky Rise', 'Solace', 'Speedway', 'Urban Plaza', 'Waterfall'];
const FOUR_TEAM = ['Aquarium', 'Archway', 'Artemis', 'Build Site', 'Carapace', 'Catalyst', 'Crimson', 'Eastwood', 'Fort Doon', 'Haven', 'Holmgang', 'Infinite', 'Invasion', 'Jurassic', 'Katsu', 'Lasagne', 'Lectus', 'Nostalgia', 'Paladin', 'Relic', 'Rise', 'Shipment', 'Sky Festival', 'Temple', 'Terminal', 'Unturned', 'Whiskers', 'Yandi'];
// locraw mode -> the variant name Hypixel reports to Lunar, and that mode's map pool.
const MODES = {
  BEDWARS_EIGHT_ONE: { name: 'Solo', maps: EIGHT_TEAM },
  BEDWARS_EIGHT_TWO: { name: 'Doubles', maps: EIGHT_TEAM },
  BEDWARS_FOUR_THREE: { name: '3v3v3v3', maps: FOUR_TEAM },
  BEDWARS_FOUR_FOUR: { name: '4v4v4v4', maps: FOUR_TEAM },
  BEDWARS_TWO_FOUR: { name: '4v4', maps: ['Cryptic', 'Frost', 'Gardens', 'Lions Temple', 'Picnic', 'Ruins'] },
};

const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const pick = (list, rand) => list[Math.min(list.length - 1, Math.floor(rand() * list.length))];

// The fake game for a real one. Never your real map; with style 'other' (default) never your
// real mode either - a sniper who queues the mode they see at the same moment you queue would
// otherwise still have a shot at your lobby. The fake mode stays put across games (people mostly
// grind one mode), and the map changes every game like a real queue would.
function pickDecoy({ realMode, realMap, style = 'other', last = null, rand = Math.random } = {}) {
  let mode;
  // mirroring needs the real map to avoid it - unknown map, fall back to a different mode
  if (style === 'mirror' && MODES[realMode] && realMap) mode = realMode;
  else if (last && MODES[last.mode] && last.mode !== realMode) mode = last.mode;
  else mode = pick(Object.keys(MODES).filter((m) => m !== realMode), rand);
  const all = MODES[mode].maps.filter((m) => !same(m, realMap));
  const fresh = all.filter((m) => !(last && same(m, last.map)));
  return { mode, map: pick(fresh.length ? fresh : all, rand) };
}

// "Minecraft 1.8.9" from the log path's Lunar profile folder (.lunarclient\profiles\1.8\logs\...).
function versionLabel(logPath) {
  const m = String(logPath || '').match(/[\\/]profiles[\\/]([^\\/]+)[\\/]logs[\\/]/i);
  const v = m ? m[1] : '1.8';
  return 'Minecraft ' + ({ '1.8': '1.8.9', '1.7': '1.7.10' }[v] || v);
}

// The activity Lunar would send for that state. fake = null -> the lobby / no-game shape.
function activity({ fake = null, startedAt, version = 'Minecraft 1.8.9' } = {}) {
  const mode = fake && MODES[fake.mode];
  const a = {
    details: mode ? 'Playing Bed Wars on Hypixel' : 'Playing Hypixel',
    state: mode ? mode.name + ' on ' + fake.map : 'On ' + version,
    assets: { large_image: HYPIXEL_LOGO, large_text: 'Hypixel', small_image: 'logo-blue', small_text: 'Lunar Client' },
    instance: false,
  };
  if (Number.isFinite(startedAt) && startedAt > 0) a.timestamps = { start: Math.floor(startedAt) };
  return a;
}

// Lunar's own presence would show your REAL game next to the decoy - this reads its launcher
// setting so Settings can warn. true / false, or null when Lunar isn't installed or unreadable.
function lunarRpcEnabled(file = path.join(os.homedir(), '.lunarclient', 'settings', 'launcher.json')) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    // real file: { "settings": { "discordRichPresence": { "enabled": ... } }, "trackingIds": ... }
    const d = j && ((j.settings && j.settings.discordRichPresence) || j.discordRichPresence);
    return d && typeof d === 'object' ? d.enabled === true : null;
  } catch (_) { return null; }
}

// PIDs of every java(w).exe - Lunar (and every other launcher) runs the game as one. tasklist is
// cheap and has no shell, so this is the 15s poll; a failure counts as "none" (presence cleared).
function javaPids(run = execFile) {
  if (process.platform !== 'win32') return Promise.resolve([]);
  return new Promise((resolve) => {
    run('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 8000, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
      if (err) { resolve([]); return; }
      const pids = [];
      for (const m of String(out || '').matchAll(/^"javaw?\.exe","(\d+)"/gim)) pids.push(Number(m[1]));
      resolve(pids);
    });
  });
}
// Which of those java processes is actually Minecraft (not an IDE, a Gradle daemon or a server),
// and when it started - Lunar's timer counts from game launch. Only run when the set of java PIDs
// changes. The command line carries the session token, so it's matched INSIDE PowerShell and only
// "pid start-ms" comes back; it never reaches this process. null if there's no game.
function findGame(run = execFile) {
  if (process.platform !== 'win32') return Promise.resolve(null);
  const ps = "Get-CimInstance Win32_Process -Filter \"Name='javaw.exe' OR Name='java.exe'\" | " +
    "Where-Object { $_.CommandLine -match '--assetIndex|--gameDir|net\\.minecraft\\.client|moonsworth|lunarclient' } | " +
    "Sort-Object CreationDate -Descending | Select-Object -First 1 | " +
    "ForEach-Object { '' + $_.ProcessId + ' ' + ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() }";
  return new Promise((resolve) => {
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 15000 }, (err, out) => {
      const m = !err && String(out || '').trim().match(/^(\d+) (\d+)$/);
      if (!m) { resolve(null); return; }
      const startedAt = Number(m[2]);
      resolve({ pid: Number(m[1]), startedAt: startedAt > 0 && startedAt <= Date.now() ? startedAt : null });
    });
  });
}

module.exports = { LUNAR_CLIENT_ID, HYPIXEL_LOGO, MODES, pickDecoy, versionLabel, activity, lunarRpcEnabled, javaPids, findGame };
