'use strict';
// Nick roller loop tests against a simulated game: a fake helper whose "screen" is a rendered
// book that changes name whenever TRY AGAIN is clicked. Run: npm test
const assert = require('assert');
const { NickRoller, buildRequirements } = require('../src/main/nickRoller');
const { loadGlyphs, renderBook, makeFrame } = require('./helpers/renderBook');

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  ok  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' -> ' + e.message); } }

// ---- requirements (no font needed) ----
const run = async () => {
  await t('requirements: rules OR-ed, built-in checks AND-ed', () => {
    const r = buildRequirements({ rules: ['Cat', '/^Dog/'], noDigits: true, maxLength: 8 });
    assert.ok(r.test('Catnip').ok); assert.ok(r.test('Doggo').ok);
    assert.strictEqual(r.test('Cat2').ok, false); assert.strictEqual(r.test('Categories').ok, false); assert.strictEqual(r.test('Bird').ok, false);
  });
  await t('requirements: built-in checks alone are enough', () => {
    const r = buildRequirements({ noDigits: true, noUnderscore: true, maxLength: 6 });
    assert.ok(r.test('Abcdef').ok); assert.strictEqual(r.test('Ab_c').ok, false);
  });
  await t('requirements: nothing configured is reported as empty', () => {
    assert.ok(buildRequirements({}).empty); assert.ok(buildRequirements({ rules: ['# only a comment'] }).empty);
  });

  const glyphs = loadGlyphs();
  if (!glyphs) { console.log('  skip  no Minecraft 1.8.9 jar found - roller loop tests skipped'); return; }

  // Simulated game: `names` is the sequence the server hands out.
  function sim(names, { process = 'javaw', loseFocusAfter = Infinity, userMovesMouseAfter = Infinity, noBook = false } = {}) {
    let i = 0, clicks = 0, frame = null;
    const helper = {
      start: async () => {},
      foreground: async () => ({ hwnd: '42', x: 0, y: 0, width: 1280, height: 720, process }),
      capture: async () => { frame = noBook ? makeFrame(640, 360, [20, 20, 20]) : renderBook(glyphs, names[Math.min(i, names.length - 1)], { unit: 1, width: 640, height: 360 }); },
      cursor: async () => (clicks >= userMovesMouseAfter ? { x: 5, y: 5 } : lastClick),
      click: async (x, y) => { if (clicks >= loseFocusAfter) return false; clicks++; lastClick = { x, y }; i++; return true; },
      stop() {},
    };
    let lastClick = { x: 0, y: 0 };
    return { helper, clicks: () => clicks, readFrame: () => frame };
  }
  const make = (s, nickRoller) => new NickRoller({
    helper: s.helper, loadGlyphs: () => glyphs, readFrame: s.readFrame,
    getConfig: () => ({ nickRoller: { delayMs: 0, maxRolls: 50, ...nickRoller }, nameWatch: { rules: ['Owl'] } }),
  });
  const done = (r) => new Promise((res) => r.once('done', res));

  await t('rolls until a name matches, then stops without clicking again', async () => {
    const s = sim(['Bird123', 'Fish_Guy', 'LuckyCat7', 'NeverSeen']);
    const r = make(s, { rules: ['Cat'] }); const d = done(r); await r.start(); const res = await d;
    assert.strictEqual(res.kind, 'match'); assert.strictEqual(res.name, 'LuckyCat7');
    assert.strictEqual(s.clicks(), 2); assert.strictEqual(r.state.history.length, 3);
  });
  await t('already-matching first name: zero clicks', async () => {
    const s = sim(['CatFirst']); const r = make(s, { rules: ['cat'] }); const d = done(r); await r.start();
    assert.strictEqual((await d).name, 'CatFirst'); assert.strictEqual(s.clicks(), 0);
  });
  await t('can include the Name Watch list', async () => {
    const s = sim(['Bird', 'SnowyOwl']); const r = make(s, { rules: [], useNameWatch: true, noDigits: false }); const d = done(r); await r.start();
    assert.strictEqual((await d).name, 'SnowyOwl');
  });
  await t('stops at the roll limit', async () => {
    const s = sim(['Aaa1', 'Bbb2', 'Ccc3', 'Ddd4', 'Eee5']); const r = make(s, { rules: ['zzz'], maxRolls: 3 }); const d = done(r); await r.start();
    const res = await d; assert.strictEqual(res.name, null); assert.match(res.message, /after 3 rolls/); assert.strictEqual(s.clicks(), 2);
  });
  await t('refuses to start unless Minecraft is focused', async () => {
    const s = sim(['Abc'], { process: 'chrome' }); const r = make(s, { rules: ['x'] }); const d = done(r); await r.start();
    const res = await d; assert.strictEqual(res.kind, 'err'); assert.match(res.message, /Focus Minecraft/); assert.strictEqual(s.clicks(), 0);
  });
  await t('stops the moment Minecraft loses focus', async () => {
    const s = sim(['Aaa1', 'Bbb2', 'Ccc3'], { loseFocusAfter: 1 }); const r = make(s, { rules: ['zzz'] }); const d = done(r); await r.start();
    assert.match((await d).message, /no longer the focused window/); assert.strictEqual(s.clicks(), 1);
  });
  await t('stops when you take the mouse back', async () => {
    const s = sim(['Aaa1', 'Bbb2', 'Ccc3', 'Ddd4'], { userMovesMouseAfter: 1 }); const r = make(s, { rules: ['zzz'] }); const d = done(r); await r.start();
    assert.match((await d).message, /moved the mouse/); assert.strictEqual(s.clicks(), 1);
  });
  await t('no book on screen -> clear error, no clicks', async () => {
    const s = sim(['x'], { noBook: true }); const r = make(s, { rules: ['x'] }); const d = done(r); await r.start();
    const res = await d; assert.match(res.message, /book not found/i); assert.strictEqual(s.clicks(), 0);
  });
  await t('hotkey stop mid-run', async () => {
    const s = sim(Array.from({ length: 40 }, (_, k) => 'Name' + k)); const r = make(s, { rules: ['zzz'], delayMs: 700 });
    const d = done(r); r.start(); setTimeout(() => r.toggle(), 1200);
    const res = await d; assert.match(res.message, /stopped by hotkey/); assert.ok(s.clicks() <= 2, 'clicks ' + s.clicks());
  });
  await t('refuses to start with no requirements', async () => {
    const s = sim(['x']); const r = make(s, { rules: [] }); const d = done(r); await r.start();
    assert.match((await d).message, /at least one requirement/); assert.strictEqual(s.clicks(), 0);
  });
};

run().then(() => { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); });
