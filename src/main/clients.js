'use strict';
// Which Minecraft client are you playing on, and where does it write its log?
//
// Every client Solar knows keeps a plain `latest.log` somewhere; this module lists all of them that
// exist on this PC and picks the one you're actually playing on right now - the one being written
// to. Switching from Lunar to OneClient (or back) needs no settings change: whichever log moves,
// Solar follows.
//
//   Lunar     ~/.lunarclient/profiles/<version>/logs/latest.log
//   OneClient %APPDATA%/Polyfrost/OneClient/clusters/<cluster>/logs/latest.log  (data_dir can move it)
//   Badlion   %APPDATA%/.minecraft/logs/blclient/minecraft/latest.log
//   Vanilla   %APPDATA%/.minecraft/logs/latest.log
//   Prism / Modrinth / CurseForge  one log per instance
const fs = require('fs');
const path = require('path');
const os = require('os');

const CLIENTS = {
  lunar: 'Lunar Client',
  oneclient: 'OneClient',
  badlion: 'Badlion',
  vanilla: 'Minecraft',
  prism: 'Prism Launcher',
  modrinth: 'Modrinth',
  curseforge: 'CurseForge',
  custom: 'Custom log',
};

const exists = (p) => { try { return fs.statSync(p).isFile(); } catch (_) { return false; } };
const dirs = (p) => { try { return fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch (_) { return []; } };

function env() {
  const home = os.homedir();
  return { home, appData: process.env.APPDATA || path.join(home, 'AppData', 'Roaming') };
}

// OneClient's own settings may move its whole data folder (settings.json "data_dir").
function oneClientRoots(e = env()) {
  const base = path.join(e.appData, 'Polyfrost', 'OneClient');
  const roots = [base];
  try {
    const s = JSON.parse(fs.readFileSync(path.join(base, 'settings.json'), 'utf8'));
    if (s && typeof s.data_dir === 'string' && s.data_dir.trim()) roots.unshift(path.resolve(s.data_dir.trim()));
  } catch (_) {}
  return [...new Set(roots)];
}

// Game version a log belongs to, from its folder name: Lunar "1.8", OneClient "1.8.9 Fabric".
function versionOf(logPath) {
  const p = String(logPath || '');
  let m = p.match(/[\\/]profiles[\\/]([^\\/]+)[\\/]logs[\\/]/i) || p.match(/[\\/]clusters[\\/]([^\\/]+)[\\/]logs[\\/]/i);
  const raw = m ? m[1] : '';
  m = raw.match(/\d+\.\d+(?:\.\d+)?/);
  if (!m) return null;
  return { '1.8': '1.8.9', '1.7': '1.7.10' }[m[0]] || m[0];
}

function clientOf(logPath) {
  const p = String(logPath || '').replace(/\//g, '\\').toLowerCase();
  if (p.includes('\\.lunarclient\\')) return 'lunar';
  if (p.includes('\\polyfrost\\oneclient\\') || p.includes('\\clusters\\')) return 'oneclient';
  if (p.includes('\\blclient\\')) return 'badlion';
  if (p.includes('\\prismlauncher\\')) return 'prism';
  if (p.includes('\\modrinthapp\\')) return 'modrinth';
  if (p.includes('\\curseforge\\')) return 'curseforge';
  if (p.endsWith('\\.minecraft\\logs\\latest.log')) return 'vanilla';
  return 'custom';
}

// Every client log on this machine: [{ client, name, label, path, version, mtime, size }], newest first.
function detectLogs(e = env()) {
  const found = [];
  const add = (client, file, label) => {
    let st; try { st = fs.statSync(file); } catch (_) { return; }
    if (!st.isFile()) return;
    const version = versionOf(file);
    found.push({ client, name: CLIENTS[client], label: label || (CLIENTS[client] + (version ? ' ' + version : '')), path: file, version, mtime: st.mtimeMs, size: st.size });
  };
  const lunar = path.join(e.home, '.lunarclient', 'profiles');
  for (const v of dirs(lunar)) add('lunar', path.join(lunar, v, 'logs', 'latest.log'));
  for (const root of oneClientRoots(e)) {
    const clusters = path.join(root, 'clusters');
    for (const c of dirs(clusters)) add('oneclient', path.join(clusters, c, 'logs', 'latest.log'), 'OneClient · ' + c);
  }
  const mc = path.join(e.appData, '.minecraft');
  add('badlion', path.join(mc, 'logs', 'blclient', 'minecraft', 'latest.log'));
  add('vanilla', path.join(mc, 'logs', 'latest.log'));
  const prism = path.join(e.appData, 'PrismLauncher', 'instances');
  for (const i of dirs(prism)) add('prism', path.join(prism, i, '.minecraft', 'logs', 'latest.log'), 'Prism · ' + i);
  const modrinth = path.join(e.appData, 'ModrinthApp', 'profiles');
  for (const i of dirs(modrinth)) add('modrinth', path.join(modrinth, i, 'logs', 'latest.log'), 'Modrinth · ' + i);
  const cf = path.join(e.home, 'curseforge', 'minecraft', 'Instances');
  for (const i of dirs(cf)) add('curseforge', path.join(cf, i, 'logs', 'latest.log'), 'CurseForge · ' + i);
  // Same file reachable twice (e.g. OneClient's .minecraft/logs symlink) only counts once.
  const seen = new Set();
  return found.filter((f) => { const k = f.path.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => b.mtime - a.mtime);
}

// The log to follow: the most recently written one. Ties (nothing written yet) favour a 1.8 log,
// since that's where Bedwars is played.
function pickActive(logs) {
  if (!logs || !logs.length) return null;
  return logs.slice().sort((a, b) => (b.mtime - a.mtime) || ((b.version === '1.8.9') - (a.version === '1.8.9')))[0];
}

// Where the game keeps options.txt for a given log (for the chat key). OneClient runs every cluster
// out of one shared ".minecraft" folder, so its options live there rather than next to the log.
function optionsCandidates(logPath) {
  const out = [];
  if (logPath) out.push(path.join(path.dirname(path.dirname(logPath)), 'options.txt'));
  if (clientOf(logPath) === 'oneclient') for (const r of oneClientRoots()) out.push(path.join(r, '.minecraft', 'options.txt'));
  return out;
}
function optionsFile(logPath) {
  let best = null, bestT = -1;
  for (const p of optionsCandidates(logPath)) {
    try { const t = fs.statSync(p).mtimeMs; if (t > bestT) { best = p; bestT = t; } } catch (_) {}
  }
  return best;
}

// A Minecraft 1.8.9 jar to read the font from (nick roller), from any client that has one.
function fontJars(e = env()) {
  const out = [];
  const mc = path.join(e.appData, '.minecraft', 'versions');
  for (const v of ['1.8.9', '1.8.8', '1.8']) out.push(path.join(mc, v, v + '.jar'));
  for (const root of oneClientRoots(e)) {
    const versions = path.join(root, 'metadata', 'versions');
    for (const v of dirs(versions).filter((d) => /^1\.8(\.\d+)?(-|$)/.test(d))) out.push(path.join(versions, v, v + '.jar'));
  }
  return out.filter(exists);
}

// OneClient's launcher can show its own Discord status; true/false, or null if unknown.
function oneClientRpcEnabled() {
  for (const root of oneClientRoots()) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(root, 'settings.json'), 'utf8'));
      if (s && typeof s.discord_enabled === 'boolean') return s.discord_enabled;
    } catch (_) {}
  }
  return null;
}

module.exports = { CLIENTS, detectLogs, pickActive, clientOf, versionOf, optionsFile, fontJars, oneClientRpcEnabled, oneClientRoots };
