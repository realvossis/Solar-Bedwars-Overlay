'use strict';
// Updater trust checks + client detection helpers. Run: npm test
const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { Updater, newer, parseSums, verifySignature, pickAsset } = require('../src/main/updater');
const clients = require('../src/main/clients');

let pass = 0, fail = 0;
const tests = [];
function t(name, fn) { tests.push([name, fn]); }

t('version compare', () => {
  assert.ok(newer('1.3.0', '1.2.9'));
  assert.ok(newer('1.10.0', '1.9.9'));
  assert.ok(!newer('1.2.9', '1.2.9'));
  assert.ok(!newer('v1.2.8', '1.2.9'));
});
t('checksum file parsing', () => {
  const h = 'a'.repeat(64);
  assert.deepStrictEqual(parseSums(`${h}  Solar.Overlay.1.3.0.exe\r\n${'b'.repeat(64)} *Other.exe\njunk`), { 'Solar.Overlay.1.3.0.exe': h, 'Other.exe': 'b'.repeat(64) });
});
t('signature: valid with the right key, invalid when tampered or signed by another key', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'pem' });
  const data = 'x'.repeat(64) + '  Solar.Overlay.1.3.0.exe\n';
  const sig = crypto.sign(null, Buffer.from(data), privateKey).toString('base64');
  assert.ok(verifySignature(data, sig, pub));
  assert.ok(!verifySignature(data.replace('x', 'y'), sig, pub));
  const other = crypto.generateKeyPairSync('ed25519');
  assert.ok(!verifySignature(data, crypto.sign(null, Buffer.from(data), other.privateKey).toString('base64'), pub));
  assert.ok(!verifySignature(data, 'not base64 at all', pub));
});
t('the built-in release key rejects a self-made signature', () => {
  const k = crypto.generateKeyPairSync('ed25519');
  assert.ok(!verifySignature('hello', crypto.sign(null, Buffer.from('hello'), k.privateKey).toString('base64')));
});
t('asset picking (GitHub renames spaces to dots)', () => {
  const assets = [{ name: 'Solar.Overlay.1.3.0.exe' }, { name: 'Solar.Overlay.Setup.1.3.0.exe' }];
  assert.strictEqual(pickAsset(assets, 'portable', '1.3.0').name, 'Solar.Overlay.1.3.0.exe');
  assert.strictEqual(pickAsset(assets, 'installer', '1.3.0').name, 'Solar.Overlay.Setup.1.3.0.exe');
  assert.strictEqual(pickAsset(assets, 'portable', '1.4.0'), null);
});

// A fake GitHub: release JSON + files, so the whole check -> verify -> download path runs offline.
function fakeGitHub({ sumsBody, sigBody, exe, host = 'objects.githubusercontent.com' }) {
  const files = { 'SHA256SUMS.txt': sumsBody, 'SHA256SUMS.txt.sig': sigBody, 'Solar.Overlay.9.9.9.exe': exe };
  const rel = { tag_name: 'v9.9.9', body: 'notes', html_url: 'https://github.com/x', assets: Object.keys(files).map((n) => ({ name: n, size: Buffer.byteLength(files[n]), browser_download_url: 'https://github.com/dl/' + n })) };
  return async (url) => {
    if (url.includes('/releases/latest')) return { ok: true, status: 200, json: async () => rel };
    const name = url.split('/').pop();
    const body = Buffer.from(files[name]);
    return { ok: true, status: 200, url: `https://${host}/${name}`, headers: { get: () => String(body.length) }, text: async () => body.toString(),
      body: (async function* () { yield body.subarray(0, 3); yield body.subarray(3); })() };
  };
}
function tmpUpdater(fetchImpl) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solar-upd-'));
  const app = { isPackaged: true, getVersion: () => '1.3.0', quit() {} };
  return new Updater({ app, version: '1.3.0', dir, env: { PORTABLE_EXECUTABLE_FILE: path.join(dir, 'Solar Overlay.exe') }, fetchImpl });
}
t('unsigned (or wrongly signed) releases are never downloaded', async () => {
  const exe = 'MZ fake exe';
  const sums = crypto.createHash('sha256').update(exe).digest('hex') + '  Solar.Overlay.9.9.9.exe\n';
  const k = crypto.generateKeyPairSync('ed25519'); // not the release key
  const u = tmpUpdater(fakeGitHub({ sumsBody: sums, sigBody: crypto.sign(null, Buffer.from(sums), k.privateKey).toString('base64'), exe }));
  const s = await u.check(true);
  assert.strictEqual(s.state, 'error');
  assert.match(s.error, /signature/);
  assert.ok(!fs.readdirSync(u.dir).some((f) => f.endsWith('.exe')));
});
t('client log paths are recognised', () => {
  assert.strictEqual(clients.clientOf('C:\\Users\\x\\.lunarclient\\profiles\\1.8\\logs\\latest.log'), 'lunar');
  assert.strictEqual(clients.clientOf('C:\\Users\\x\\AppData\\Roaming\\Polyfrost\\OneClient\\clusters\\1.8.9 Fabric\\logs\\latest.log'), 'oneclient');
  assert.strictEqual(clients.clientOf('C:\\Users\\x\\AppData\\Roaming\\.minecraft\\logs\\blclient\\minecraft\\latest.log'), 'badlion');
  assert.strictEqual(clients.clientOf('C:\\Users\\x\\AppData\\Roaming\\.minecraft\\logs\\latest.log'), 'vanilla');
  assert.strictEqual(clients.clientOf('D:\\stuff\\my.log'), 'custom');
  assert.strictEqual(clients.versionOf('C:\\a\\OneClient\\clusters\\1.8.9 Fabric\\logs\\latest.log'), '1.8.9');
  assert.strictEqual(clients.versionOf('C:\\a\\.lunarclient\\profiles\\1.8\\logs\\latest.log'), '1.8.9');
  assert.strictEqual(clients.versionOf('C:\\a\\.lunarclient\\profiles\\1.21\\logs\\latest.log'), '1.21');
});
t('the most recently written log wins', () => {
  const pick = clients.pickActive([{ path: 'a', mtime: 5 }, { path: 'b', mtime: 9 }, { path: 'c', mtime: 1 }]);
  assert.strictEqual(pick.path, 'b');
  assert.strictEqual(clients.pickActive([]), null);
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log('  ok  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' -> ' + e.message); }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
