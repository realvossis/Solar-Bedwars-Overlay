'use strict';
// Updates straight from the GitHub releases, so a new version never has to be downloaded by hand.
//
// Trust: a release is only installed when its SHA256SUMS.txt carries a valid Ed25519 signature
// from the release key (public half below; the private half never leaves the release machine and
// is not in the repo) AND the downloaded file matches the signed hash. Someone who got hold of the
// GitHub repo or a download mirror still couldn't ship code to this app. Downloads only come from
// GitHub's own hosts, over HTTPS.
//
// Flow: check on launch and every few hours -> download quietly -> "ready". Nothing restarts on its
// own mid-game: the update applies when you click Restart (overlay pill / Settings -> About) or
// whenever you quit Solar.
//   portable exe: the new exe replaces the old one in place (a version number in the old file
//                 name, as GitHub downloads have, becomes plain "Solar Overlay.exe")
//   installed:    the new installer runs silently over the old install
const { EventEmitter } = require('events');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const REPO = 'realvossis/Solar-Bedwars-Overlay';
const RELEASE_PUBLIC_KEY = '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAhVVI0Ye7BzE2IiY/6OyW1SVdvZ8KDCt+EB0Hwopi/78=\n-----END PUBLIC KEY-----\n';
const DOWNLOAD_HOSTS = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com', 'github-releases.githubusercontent.com']);
const FIRST_CHECK_MS = 8000;
const CHECK_EVERY_MS = 4 * 3600 * 1000;

// "1.10.0" > "1.9.3"; pre-release suffixes are ignored (releases here are plain x.y.z).
function newer(a, b) {
  const pa = String(a).replace(/^v/, '').split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

// SHA256SUMS.txt: "<64 hex>  <file name>" per line -> { name: hash }.
function parseSums(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
    if (m) out[m[2].trim()] = m[1].toLowerCase();
  }
  return out;
}
function verifySignature(data, sigB64, publicKey = RELEASE_PUBLIC_KEY) {
  try { return crypto.verify(null, Buffer.from(data), publicKey, Buffer.from(String(sigB64).trim(), 'base64')); } catch (_) { return false; }
}
// GitHub turns spaces in uploaded names into dots: "Solar Overlay 1.3.0.exe" -> "Solar.Overlay.1.3.0.exe".
const norm = (n) => String(n).replace(/ /g, '.');
function pickAsset(assets, kind, version) {
  const want = kind === 'installer' ? `Solar.Overlay.Setup.${version}.exe` : `Solar.Overlay.${version}.exe`;
  return (assets || []).find((a) => norm(a.name) === want) || null;
}

class Updater extends EventEmitter {
  // app: electron app. Everything else is derived, but injectable for tests.
  constructor({ app, version = app.getVersion(), dir = path.join(app.getPath('userData'), 'updates'), env = process.env, fetchImpl = fetch } = {}) {
    super();
    this.app = app;
    this.version = version;
    this.dir = dir;
    this.fetch = fetchImpl;
    this.portable = env.PORTABLE_EXECUTABLE_FILE || null;
    this.kind = !app.isPackaged ? null : this.portable ? 'portable' : 'installer';
    this.state = { state: 'idle', current: version, kind: this.kind };
    this.timer = null;
    this.busy = false;
    this.applied = false;
  }

  _set(patch) { this.state = { ...this.state, ...patch }; this.emit('state', this.state); }

  configure(enabled) {
    clearTimeout(this.timer); clearInterval(this.interval); this.timer = this.interval = null;
    if (!enabled) return;
    this.timer = setTimeout(() => this.check(false), FIRST_CHECK_MS);
    this.interval = setInterval(() => this.check(false), CHECK_EVERY_MS);
  }

  async _json(url) {
    const r = await this.fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'SolarOverlay/' + this.version }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('GitHub ' + r.status);
    return r.json();
  }
  async _download(url, maxBytes) {
    const r = await this.fetch(url, { headers: { 'User-Agent': 'SolarOverlay/' + this.version }, redirect: 'follow', signal: AbortSignal.timeout(10 * 60 * 1000) });
    const host = (() => { try { return new URL(r.url || url).hostname; } catch (_) { return ''; } })();
    if (!r.ok) throw new Error('download ' + r.status);
    if (!DOWNLOAD_HOSTS.has(host)) throw new Error('unexpected download host ' + host);
    return { r, maxBytes };
  }
  async _text(url) {
    const { r } = await this._download(url);
    const t = await r.text();
    if (t.length > 64 * 1024) throw new Error('checksum file too large');
    return t;
  }

  // manual: from the Settings button (also reports "you're up to date").
  async check(manual) {
    if (this.busy || this.applied) return this.state;
    if (this.state.state === 'ready') return this.state;
    this.busy = true;
    this._set({ state: 'checking', error: null });
    try {
      const rel = await this._json(`https://api.github.com/repos/${REPO}/releases/latest`);
      const latest = String(rel.tag_name || '').replace(/^v/, '');
      if (!/^\d+\.\d+\.\d+$/.test(latest)) throw new Error('no release found');
      if (!newer(latest, this.version)) { this._set({ state: 'latest', latest, checkedAt: Date.now() }); return this.state; }
      const info = { latest, notes: String(rel.body || '').slice(0, 4000), url: String(rel.html_url || ''), checkedAt: Date.now() };
      if (!this.kind) { this._set({ state: 'available', ...info }); return this.state; } // dev build: tell, don't touch
      const asset = pickAsset(rel.assets, this.kind, latest);
      const sums = (rel.assets || []).find((a) => a.name === 'SHA256SUMS.txt');
      const sig = (rel.assets || []).find((a) => a.name === 'SHA256SUMS.txt.sig');
      if (!asset || !sums || !sig) { this._set({ state: 'available', ...info, error: 'This release has no signed download for your copy - get it from GitHub.' }); return this.state; }
      // Signature first: nothing unverified is downloaded past the small checksum file.
      const [sumsText, sigText] = await Promise.all([this._text(sums.browser_download_url), this._text(sig.browser_download_url)]);
      if (!verifySignature(sumsText, sigText)) throw new Error('release signature is invalid - not installing it');
      const expected = parseSums(sumsText)[norm(asset.name)] || parseSums(sumsText)[asset.name];
      if (!expected) throw new Error('release checksums do not list ' + asset.name);
      this._set({ state: 'downloading', ...info, progress: 0 });
      const file = await this._fetchVerified(asset, expected);
      this._set({ state: 'ready', ...info, file, progress: 1 });
      return this.state;
    } catch (e) {
      this._set({ state: 'error', error: String(e.message || e) });
      return this.state;
    } finally { this.busy = false; }
  }

  async _fetchVerified(asset, expected) {
    fs.mkdirSync(this.dir, { recursive: true });
    for (const f of fs.readdirSync(this.dir)) if (/\.(exe|part)$/i.test(f)) fs.rmSync(path.join(this.dir, f), { force: true });
    const dest = path.join(this.dir, norm(asset.name));
    const part = dest + '.part';
    const { r } = await this._download(asset.browser_download_url);
    const total = Number(r.headers.get('content-length')) || asset.size || 0;
    if (total > 400 * 1024 * 1024) throw new Error('download too large');
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(part);
    let got = 0, lastEmit = 0;
    try {
      for await (const chunk of r.body) {
        got += chunk.length;
        if (got > 400 * 1024 * 1024) throw new Error('download too large');
        hash.update(chunk);
        if (!out.write(chunk)) await new Promise((res) => out.once('drain', res));
        if (total && Date.now() - lastEmit > 250) { lastEmit = Date.now(); this._set({ progress: got / total }); }
      }
      await new Promise((res, rej) => out.end((err) => (err ? rej(err) : res())));
    } catch (e) { out.destroy(); fs.rmSync(part, { force: true }); throw e; }
    if (hash.digest('hex') !== expected) { fs.rmSync(part, { force: true }); throw new Error('download does not match the signed checksum - discarded'); }
    fs.renameSync(part, dest);
    return dest;
  }

  // Applies a ready update. relaunch=false when quitting anyway (the update just lands for next time).
  install(relaunch = true) {
    const s = this.state;
    if (s.state !== 'ready' || !s.file || this.applied || !fs.existsSync(s.file)) return false;
    this.applied = true;
    if (this.kind === 'installer') {
      // electron-builder's NSIS installer: /S = silent, --force-run = start the app when done.
      spawn(s.file, relaunch ? ['/S', '--force-run'] : ['/S'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else {
      this._swapPortable(s.file, relaunch);
    }
    setTimeout(() => this.app.quit(), 200);
    return true;
  }

  // The running portable exe can't be overwritten until Solar has exited, so a small hidden
  // PowerShell script waits for that, moves the new exe into place and (optionally) starts it.
  _swapPortable(file, relaunch) {
    const cur = this.portable;
    const dir = path.dirname(cur);
    const versioned = /^Solar[ .]Overlay[ .]\d+\.\d+\.\d+\.exe$/i.test(path.basename(cur));
    const target = versioned ? path.join(dir, 'Solar Overlay.exe') : cur;
    const q = (p) => "'" + String(p).replace(/'/g, "''") + "'";
    const script = [
      '$ErrorActionPreference = "Stop"',
      `$src = ${q(file)}; $dst = ${q(target)}; $old = ${q(cur)}`,
      'for ($i = 0; $i -lt 120; $i++) {',
      '  try { Copy-Item -LiteralPath $src -Destination $dst -Force; break } catch { Start-Sleep -Milliseconds 500 }',
      '}',
      'if ($old -ne $dst) { for ($i = 0; $i -lt 20; $i++) { try { Remove-Item -LiteralPath $old -Force; break } catch { Start-Sleep -Milliseconds 500 } } }',
      'Remove-Item -LiteralPath $src -Force -ErrorAction SilentlyContinue',
      relaunch ? 'Start-Process -FilePath $dst' : '',
    ].join('\r\n');
    const ps1 = path.join(this.dir, 'apply-update.ps1');
    fs.writeFileSync(ps1, script, 'utf8');
    spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', ps1],
      { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  }
}

module.exports = { Updater, newer, parseSums, verifySignature, pickAsset, RELEASE_PUBLIC_KEY };
