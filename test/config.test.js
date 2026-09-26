'use strict';
// Config persistence tests: key encryption at rest, redaction, migrations, and patch sanitizing.
// Electron's app/safeStorage are stubbed so this runs under plain Node. Run: npm test
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solar-cfg-'));
// Reversible stand-in for DPAPI - enough to prove keys never hit disk in plaintext.
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from('SEALED:' + Buffer.from(s).toString('hex')),
  decryptString: (b) => { const s = b.toString(); if (!s.startsWith('SEALED:')) throw new Error('bad'); return Buffer.from(s.slice(7), 'hex').toString(); },
};
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'electron') return { app: { getPath: () => dir }, safeStorage };
  if (req === './secrets') throw new Error('no secrets in tests');
  return origLoad.call(this, req, ...rest);
};
const fresh = () => { delete require.cache[require.resolve('../src/main/config')]; return require('../src/main/config'); };
const file = path.join(dir, 'config.json');
const raw = () => fs.readFileSync(file, 'utf8');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ok  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' -> ' + e.message); } }

t('keys are encrypted on disk and decrypted in memory', () => {
  const c = fresh();
  c.save({ hypixelKey: 'hyp-secret-123', connections: [{ id: 'x', name: 'X', endpoint: 'https://a', key: 'conn-secret' }] });
  assert.ok(!raw().includes('hyp-secret-123') && !raw().includes('conn-secret'), 'plaintext key found on disk');
  const c2 = fresh();
  assert.strictEqual(c2.load().hypixelKey, 'hyp-secret-123');
  assert.strictEqual(c2.load().connections[0].key, 'conn-secret');
});
t('plaintext keys from an older version get encrypted on first load', () => {
  fs.writeFileSync(file, JSON.stringify({ version: 2, urchinKey: 'legacy-plain' }));
  const c = fresh();
  assert.strictEqual(c.load().urchinKey, 'legacy-plain');
  assert.ok(!raw().includes('legacy-plain'));
});
t('redact hides keys but shows one is set', () => {
  const c = fresh();
  const r = c.redact({ hypixelKey: 'abc', urchinKey: '', connections: [{ id: 'x', key: 'k' }] });
  assert.strictEqual(r.hypixelKey, c.REDACTED); assert.strictEqual(r.urchinKey, ''); assert.strictEqual(r.connections[0].key, c.REDACTED);
});
t('a redacted placeholder can never overwrite a real key', () => {
  const c = fresh();
  c.save({ hypixelKey: 'real', connections: [{ id: 'x', key: 'realconn' }] });
  c.save({ hypixelKey: c.REDACTED, connections: [{ id: 'x', key: c.REDACTED }] });
  assert.strictEqual(c.load().hypixelKey, 'real'); assert.strictEqual(c.load().connections[0].key, 'realconn');
});
t('v1 config: killed-you trigger and its bogus watchlist flags are removed', () => {
  fs.writeFileSync(file, JSON.stringify({ version: 1, triggers: { onKilledYou: true, onNameInChat: false },
    watchlist: { a: { reason: 'final-killed you' }, b: { reason: 'party invite' } } }));
  const cfg = fresh().load();
  assert.ok(!('onKilledYou' in cfg.triggers)); assert.strictEqual(cfg.triggers.onNameInChat, false);
  assert.deepStrictEqual(Object.keys(cfg.watchlist), ['b']);
  assert.strictEqual(JSON.parse(raw()).version, 2);
});
t('prototype-pollution keys in a patch are dropped', () => {
  const c = fresh();
  c.save(JSON.parse('{"__proto__":{"polluted":1},"theme":{"constructor":{"x":1},"bg":"#000000"}}'));
  assert.strictEqual({}.polluted, undefined); assert.strictEqual(c.load().theme.bg, '#000000');
  assert.ok(!Object.prototype.hasOwnProperty.call(c.load().theme, 'constructor'));
});
t('GPU acceleration defaults off and is readable before app ready', () => {
  fs.rmSync(file, { force: true });
  const c = fresh();
  assert.strictEqual(c.defaults().gpuAcceleration, false);
  assert.strictEqual(c.readEarly('gpuAcceleration', false), false);
  c.save({ gpuAcceleration: true });
  assert.strictEqual(fresh().readEarly('gpuAcceleration', false), true);
});

Module._load = origLoad;
fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
