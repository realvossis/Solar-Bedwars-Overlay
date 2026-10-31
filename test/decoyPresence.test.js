'use strict';
// Discord decoy: never your real game, Lunar's exact presence shape, helpers. Run: npm test
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const d = require('../src/main/decoyPresence');

let pass = 0, fail = 0;
const queue = [];
function t(name, fn) { queue.push([name, fn]); }

// deterministic "random" sequence so every branch gets walked
const seq = (n) => { let i = 0; return () => ((i++ * 0.6180339887) % 1 + n) % 1; };
const MODES = Object.keys(d.MODES);

t('default style never shows your real mode or map', () => {
  for (const realMode of MODES) for (const realMap of d.MODES[realMode].maps) for (let s = 0; s < 5; s++) {
    const f = d.pickDecoy({ realMode, realMap, rand: seq(s / 5) });
    assert.notStrictEqual(f.mode, realMode); assert.notStrictEqual(f.map, realMap);
    assert.ok(d.MODES[f.mode].maps.includes(f.map), f.mode + ' / ' + f.map);
  }
});
t('mirror keeps your mode but never your map (case-insensitive)', () => {
  for (let s = 0; s < 40; s++) {
    const f = d.pickDecoy({ realMode: 'BEDWARS_FOUR_FOUR', realMap: 'lectus', style: 'mirror', rand: seq(s / 40) });
    assert.strictEqual(f.mode, 'BEDWARS_FOUR_FOUR'); assert.notStrictEqual(f.map, 'Lectus');
  }
});
t('the fake mode sticks across games, the map changes every game', () => {
  let last = null;
  for (let g = 0; g < 30; g++) {
    const f = d.pickDecoy({ realMode: 'BEDWARS_EIGHT_TWO', realMap: 'Lighthouse', last, rand: seq(g / 30) });
    if (last) { assert.strictEqual(f.mode, last.mode); assert.notStrictEqual(f.map, last.map); }
    last = f;
  }
});
t('a remembered fake mode that equals your real mode is replaced', () => {
  const f = d.pickDecoy({ realMode: 'BEDWARS_TWO_FOUR', realMap: 'Frost', last: { mode: 'BEDWARS_TWO_FOUR', map: 'Picnic' }, rand: seq(0.3) });
  assert.notStrictEqual(f.mode, 'BEDWARS_TWO_FOUR');
});
t('non-core / unknown real modes still get a core fake game', () => {
  for (const realMode of ['BEDWARS_FOUR_FOUR_ULTIMATE', null, undefined, 'DUELS_SUMO_DUEL']) {
    const f = d.pickDecoy({ realMode, realMap: null, style: 'mirror', rand: seq(0.5) });
    assert.ok(d.MODES[f.mode]);
  }
});
t('rand() returning 1 (or just under) stays in range', () => {
  const f = d.pickDecoy({ realMode: 'BEDWARS_EIGHT_ONE', realMap: 'x', rand: () => 0.9999999999 });
  assert.ok(d.MODES[f.mode].maps.includes(f.map));
});

t('in-game activity matches Lunar exactly (the reference screenshot)', () => {
  const a = d.activity({ fake: { mode: 'BEDWARS_FOUR_FOUR', map: 'Shipwreck' }, startedAt: 1700000000123.7 });
  assert.deepStrictEqual(a, {
    details: 'Playing Bed Wars on Hypixel', state: '4v4v4v4 on Shipwreck',
    assets: { large_image: d.HYPIXEL_LOGO, large_text: 'Hypixel', small_image: 'logo-blue', small_text: 'Lunar Client' },
    instance: false, timestamps: { start: 1700000000123 },
  });
});
t('lobby activity uses Lunar\'s no-game shape', () => {
  const a = d.activity({ fake: null, startedAt: null, version: 'Minecraft 1.8.9' });
  assert.strictEqual(a.details, 'Playing Hypixel'); assert.strictEqual(a.state, 'On Minecraft 1.8.9');
  assert.strictEqual(a.timestamps, undefined);
});
t('every mode/map renders within Discord\'s 128-char field limit', () => {
  for (const m of MODES) for (const map of d.MODES[m].maps) {
    const a = d.activity({ fake: { mode: m, map } });
    assert.ok(a.state.length >= 2 && a.state.length <= 128);
  }
});
t('version label comes from the Lunar profile folder', () => {
  assert.strictEqual(d.versionLabel('C:\\Users\\x\\.lunarclient\\profiles\\1.8\\logs\\latest.log'), 'Minecraft 1.8.9');
  assert.strictEqual(d.versionLabel('/home/x/.lunarclient/profiles/1.21/logs/latest.log'), 'Minecraft 1.21');
  assert.strictEqual(d.versionLabel('C:\\Users\\x\\AppData\\Roaming\\.minecraft\\logs\\latest.log'), 'Minecraft 1.8.9');
});
t('reads Lunar\'s own Discord RPC setting', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solar-decoy-'));
  const f = path.join(dir, 'launcher.json');
  try {
    fs.writeFileSync(f, '{\n\t"discordRichPresence": {\n\t\t"enabled": true,\n\t\t"hideWhenIdle": true\n\t}\n}');
    assert.strictEqual(d.lunarRpcEnabled(f), true);
    fs.writeFileSync(f, '{"discordRichPresence":{"enabled":false}}');
    assert.strictEqual(d.lunarRpcEnabled(f), false);
    // the real launcher.json nests it under "settings"
    fs.writeFileSync(f, `{
	"settings": {
		"discordRichPresence": {
			"enabled": true
		}
	},
	"trackingIds": {}
}`);
    assert.strictEqual(d.lunarRpcEnabled(f), true);
    fs.writeFileSync(f, '{"settings":{"discordRichPresence":{"enabled":false}}}');
    assert.strictEqual(d.lunarRpcEnabled(f), false);
    fs.writeFileSync(f, 'not json');
    assert.strictEqual(d.lunarRpcEnabled(f), null);
    assert.strictEqual(d.lunarRpcEnabled(path.join(dir, 'missing.json')), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
t('javaPids lists only java/javaw processes', async () => {
  if (process.platform !== 'win32') return;
  const fake = (out) => (cmd, args, opts, cb) => cb(null, out);
  const yes = await d.javaPids(fake('"System","4","Services","0","8 K"\r\n"javaw.exe","9120","Console","1","900,000 K"\r\n"java.exe","77","Console","1","1 K"\r\n'));
  const no = await d.javaPids(fake('"notjavaw.exe","9","Console","1","1 K"\r\n"javawx.exe","1","C","1","1 K"\r\n'));
  const err = await d.javaPids((c, a, o, cb) => cb(new Error('x')));
  assert.deepStrictEqual([yes, no, err], [[9120, 77], [], []]);
});
t('findGame parses only a clean "pid start-ms" answer, never trusts a future start', async () => {
  if (process.platform !== 'win32') return;
  const fake = (out, err = null) => (cmd, args, opts, cb) => cb(err, out);
  assert.deepStrictEqual(await d.findGame(fake('9120 1700000000000\r\n')), { pid: 9120, startedAt: 1700000000000 });
  assert.deepStrictEqual(await d.findGame(fake('9120 ' + (Date.now() + 864e5))), { pid: 9120, startedAt: null });
  assert.strictEqual(await d.findGame(fake('')), null);
  assert.strictEqual(await d.findGame(fake('garbage --accessToken x')), null);
  assert.strictEqual(await d.findGame(fake('', new Error('x'))), null);
});
t('the command line (session token) is filtered inside PowerShell, never returned', async () => {
  if (process.platform !== 'win32') return;
  let script = '';
  await d.findGame((cmd, args, opts, cb) => { script = args.join(' '); cb(null, ''); });
  assert.ok(/Where-Object \{ \$_\.CommandLine -match/.test(script));
  assert.ok(/ProcessId \+ ' ' \+/.test(script) && !/Select-Object [^|]*CommandLine/.test(script));
});
t('mirror with an unknown real map falls back to a different mode', () => {
  for (let s = 0; s < 20; s++) {
    const f = d.pickDecoy({ realMode: 'BEDWARS_FOUR_FOUR', realMap: null, style: 'mirror', rand: seq(s / 20) });
    assert.notStrictEqual(f.mode, 'BEDWARS_FOUR_FOUR');
  }
});

(async () => {
  for (const [name, fn] of queue) {
    try { await fn(); pass++; console.log('  ok  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' -> ' + e.message); }
  }
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
