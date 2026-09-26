'use strict';
// Nick-book reader tests on rendered pages at many GUI scales. Needs a local Minecraft 1.8.9
// install for the font (Mojang's asset, never committed); skips cleanly without one. Run: npm test
const assert = require('assert');
const { readRolledName, findBook } = require('../src/main/bookReader');
const { loadGlyphs, renderBook, makeFrame } = require('./helpers/renderBook');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ok  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' -> ' + e.message); } }

const glyphs = loadGlyphs();
if (!glyphs) { console.log('  skip  no Minecraft 1.8.9 jar found - bookReader tests skipped'); process.exit(0); }

// Every character class, plus the historically confusable ones (M/H, 0/O, l/I/i/1, _).
const NAMES = ['EzraMorales2003', 'MHMHMH', 'O0o0lI1i', 'xX_Cat_Xx', 'Zygote_99', 'qwertyuiopasdfgh', 'ZXCVBNMLKJHGFDSA', 'abc'];
for (const unit of [1, 2, 3, 4, 2.25, 2.5, 3.2]) {
  t(`reads every name exactly at GUI scale ${unit}`, () => {
    for (const name of NAMES) {
      const r = readRolledName(renderBook(glyphs, name, { unit, width: Math.round(640 * unit), height: Math.round(360 * unit) }), glyphs);
      assert.ok(r.ok, `${name}: ${r.reason} (${r.line && r.line.text})`);
      assert.strictEqual(r.name, name);
    }
  });
}
t('TRY AGAIN click target lands on the red link', () => {
  const f = renderBook(glyphs, 'Somebody', { unit: 2 });
  const b = findBook(f);
  const i = (b.tryAgain.y * f.width + b.tryAgain.x) * 4;
  // Centre of the link's bounding box sits inside the red text line.
  assert.ok(b.tryAgain.y >= b.red.y0 && b.tryAgain.y <= b.red.y1 && b.tryAgain.x >= b.red.x0 && b.tryAgain.x <= b.red.x1, JSON.stringify(b.tryAgain));
  assert.ok(i >= 0);
});
t('no book on screen -> not found (never a guess)', () => {
  assert.strictEqual(readRolledName(makeFrame(1280, 720, [30, 60, 30]), glyphs).reason, 'book not found');
});
t('a stray green/red pair elsewhere is not mistaken for the book', () => {
  const f = makeFrame(1280, 720, [30, 60, 30]);
  for (let y = 600; y < 620; y++) for (let x = 600; x < 700; x++) { const i = (y * 1280 + x) * 4; f.data[i] = 0; f.data[i + 1] = 170; f.data[i + 2] = 0; }
  assert.strictEqual(readRolledName(f, glyphs).ok, false);
});
t('an illegible name is rejected, not guessed', () => {
  const f = renderBook(glyphs, 'Readable', { unit: 2 });
  // Smear the name line with noise.
  const b = findBook(f), top = Math.round(b.lineTop(2));
  for (let y = top; y < top + 16; y++) for (let x = b.textX0; x < b.textX0 + 120; x += 2) { const i = (y * f.width + x) * 4; f.data[i] = f.data[i + 1] = f.data[i + 2] = (x + y) % 3 ? 0 : 255; }
  assert.strictEqual(readRolledName(f, glyphs).ok, false);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
