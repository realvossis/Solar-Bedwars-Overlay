'use strict';
// Test helper: renders a synthetic Hypixel random-name book page into an RGBA frame, laid out the
// way Minecraft does it (centred book, text column at centre - 60 font px, 9px lines), using the
// real vanilla glyphs. Lets the reader/roller be tested at any GUI scale without screenshots.
const fs = require('fs');
const path = require('path');
const { readEntry } = require('../../src/main/zipReader');
const png = require('../../src/main/png');
const { loadFont } = require('../../src/main/bookReader');

function findJar() {
  const base = path.join(process.env.APPDATA || '', '.minecraft', 'versions', '1.8.9', '1.8.9.jar');
  return fs.existsSync(base) ? base : null;
}
function loadGlyphs() {
  const jar = findJar();
  if (!jar) return null;
  return loadFont(png.decode(readEntry(jar, 'assets/minecraft/textures/font/ascii.png')));
}

function makeFrame(w, h, rgb) {
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = rgb[0]; data[i * 4 + 1] = rgb[1]; data[i * 4 + 2] = rgb[2]; data[i * 4 + 3] = 255; }
  return { width: w, height: h, data };
}
function fillRect(f, x0, y0, x1, y1, rgb) {
  for (let y = Math.max(0, Math.round(y0)); y < Math.min(f.height, Math.round(y1)); y++)
    for (let x = Math.max(0, Math.round(x0)); x < Math.min(f.width, Math.round(x1)); x++) {
      const i = (y * f.width + x) * 4; f.data[i] = rgb[0]; f.data[i + 1] = rgb[1]; f.data[i + 2] = rgb[2];
    }
}
// Draws text with glyph pixels scaled to `unit` screen px (fractional units allowed).
function drawText(f, glyphs, text, x, top, unit, rgb) {
  const byCh = new Map(glyphs.map((g) => [g.ch, g]));
  for (const ch of text) {
    if (ch === ' ') { x += 4 * unit; continue; }
    const g = byCh.get(ch);
    for (let r = 0; r < 8; r++) for (let c = 0; c < g.width; c++)
      if (g.bits[r][c]) fillRect(f, x + c * unit, top + r * unit, x + (c + 1) * unit, top + (r + 1) * unit, rgb);
    x += (g.width + 1) * unit;
  }
  return x;
}

// A frame the size of the roller's capture crop (top-centre half of a w x h game window).
function renderBook(glyphs, name, { unit = 2, width = 1280, height = 720, background = [40, 90, 50] } = {}) {
  const f = makeFrame(width, height, background);
  const cx = width / 2, bookTop = 2 * unit;
  fillRect(f, cx - 73 * unit, bookTop, cx + 73 * unit, bookTop + 180 * unit, [255, 250, 240]); // page
  fillRect(f, cx - 70 * unit, bookTop, cx - 67 * unit, bookTop + 180 * unit, [150, 30, 30]);  // binding marks
  const textX = cx - 60 * unit, line = (n) => bookTop + 16 * unit + n * 9 * unit;
  drawText(f, glyphs, 'We have generated a', textX, line(0), unit, [0, 0, 0]);
  drawText(f, glyphs, 'random username for', textX, line(1), unit, [0, 0, 0]);
  drawText(f, glyphs, 'you', textX, line(2), unit, [0, 0, 0]);
  drawText(f, glyphs, name, textX, line(3), unit, [0, 0, 0]);
  drawText(f, glyphs, '     USE NAME', textX, line(5), unit, [0, 170, 0]);
  drawText(f, glyphs, '    TRY AGAIN', textX, line(6), unit, [255, 85, 85]);
  return f;
}

module.exports = { loadGlyphs, renderBook, makeFrame };
