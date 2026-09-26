'use strict';
// Reads the rolled name off Hypixel's "We've generated a random username for you" nick book,
// straight from a screen capture. Pure pixel logic, no I/O, so it's testable against real
// screenshots (test/bookReader.test.js).
//
// Why not a generic OCR engine: Windows OCR reads Minecraft's pixel font as e.g.
// "EzraHorales2ØØ3" (M->H, 0->Ø) - fatal when the whole point is to stop on the right name. The
// font is known exactly, though: this matches every character against the real vanilla glyphs
// from the player's own Minecraft jar (font/ascii.png), after resampling onto the font's 8px grid,
// so it works at any GUI scale / resolution and with Lunar's smoothed font rendering.
//
// Finding the book is scale-independent too: the page's two links are always Minecraft's
// green (USE NAME, §2 = 0,170,0) and light red (TRY AGAIN, §c = 255,85,85), stacked, near the
// top-centre of the screen. The name is the black text line two lines above the green one.

const NAME_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_';
const LINE_UNITS = 9; // book text line height, in font pixels
const MAX_CHAR_DIST = 0.3;

// ---- font ----
// ascii.png is a 16x16 grid of 8x8 cells indexed by character code; a glyph's width is its
// rightmost opaque column + 1 (exactly how Minecraft's FontRenderer measures it).
function loadFont(img) {
  const cell = img.width / 16;
  if (!Number.isInteger(cell) || cell < 8 || img.height !== img.width) throw new Error('unexpected font texture size');
  const s = cell / 8; // HD resource-pack fonts: sample back down to 8x8
  const glyphs = [];
  for (const ch of NAME_CHARS) {
    const code = ch.charCodeAt(0), gx = (code % 16) * cell, gy = Math.floor(code / 16) * cell;
    const bits = [];
    let width = 0;
    for (let y = 0; y < 8; y++) {
      const row = [];
      for (let x = 0; x < 8; x++) {
        const a = img.data[((gy + Math.floor((y + 0.5) * s)) * img.width + gx + Math.floor((x + 0.5) * s)) * 4 + 3];
        row.push(a > 127);
        if (a > 127 && x + 1 > width) width = x + 1;
      }
      bits.push(row);
    }
    glyphs.push({ ch, width, bits: bits.map((r) => r.slice(0, width)) });
  }
  return glyphs;
}

// ---- frame helpers (frame = { width, height, data: RGBA Buffer }) ----
const px = (f, x, y) => { const i = (y * f.width + x) * 4; return [f.data[i], f.data[i + 1], f.data[i + 2]]; };
const near = (c, r, g, b, tol) => Math.abs(c[0] - r) <= tol && Math.abs(c[1] - g) <= tol && Math.abs(c[2] - b) <= tol;
const isGreen = (c) => near(c, 0, 170, 0, 45);
const isRed = (c) => near(c, 255, 85, 85, 45);
// Book text is black; its smoothed edges are neutral grey. The page's dark-red binding marks and
// brown border are dark too, but never neutral - that's what keeps them out.
const inkOf = (c) => {
  const mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]);
  if (mx - mn > 40) return 0;               // coloured, not text
  return Math.max(0, Math.min(1, (200 - mx) / 140)); // 1 = black, 0 = page
};
const isInk = (c) => inkOf(c) >= 0.5;

// Horizontal bands of rows containing >= minCount matching pixels in [x0,x1).
function bands(f, test, x0, x1, y0, y1, minCount) {
  const out = [];
  let cur = null;
  for (let y = y0; y < y1; y++) {
    let n = 0, lo = Infinity, hi = -1;
    for (let x = x0; x < x1; x++) if (test(px(f, x, y))) { n++; if (x < lo) lo = x; if (x > hi) hi = x; }
    if (n >= minCount) {
      if (cur && y === cur.y1 + 1) { cur.y1 = y; cur.x0 = Math.min(cur.x0, lo); cur.x1 = Math.max(cur.x1, hi); }
      else { cur = { y0: y, y1: y, x0: lo, x1: hi }; out.push(cur); }
    }
  }
  return out;
}

// Locates the random-name page. Returns null when it isn't on screen.
function findBook(f) {
  const x0 = Math.floor(f.width * 0.3), x1 = Math.ceil(f.width * 0.7), y1 = Math.ceil(f.height * 0.5);
  const greens = bands(f, isGreen, x0, x1, 0, y1, 3);
  const reds = bands(f, isRed, x0, x1, 0, y1, 3);
  for (let i = 0; i < greens.length; i++) {
    const g = greens[i];
    const unit = (g.y1 - g.y0 + 1) / 7; // letter block of "USE NAME" = 7 font pixels tall
    if (unit < 0.8 || unit > 12) continue;
    // "TRY AGAIN" letters sit one text line (9 units) below "USE NAME".
    const r = reds.find((b) => Math.abs(b.y0 - (g.y0 + LINE_UNITS * unit)) <= 2.5 * unit && Math.abs((b.y1 - b.y0 + 1) - 7 * unit) <= 2 * unit
      && b.x0 < g.x1 && b.x1 > g.x0);
    if (!r) continue;
    // Minecraft centres the 192px-wide book in the window and starts text 36px in, so the text
    // column is [centre - 60, centre + 56] font px. Requires the frame to be the game's client
    // area (the links can't be used for this - Hypixel indents them with spaces).
    const centerX = f.width / 2;
    return {
      unit,
      green: g, red: r,
      tryAgain: { x: Math.round((r.x0 + r.x1) / 2), y: Math.round((r.y0 + r.y1) / 2) },
      useName: { x: Math.round((g.x0 + g.x1) / 2), y: Math.round((g.y0 + g.y1) / 2) },
      textX0: Math.max(0, Math.floor(centerX - 61 * unit)),
      textX1: Math.min(f.width, Math.ceil(centerX + 57 * unit)),
      lineTop: (k) => g.y0 - k * LINE_UNITS * unit, // row 0 of the text line k lines above USE NAME
    };
  }
  return null;
}

// Average ink over the rectangle [ax,bx) x [ay,by), weighting edge pixels by how much of them
// the rectangle actually covers - units are rarely whole pixels.
function cellInk(f, ax, bx, ay, by) {
  let sum = 0, area = 0;
  for (let y = Math.floor(ay); y < Math.ceil(by); y++) {
    if (y < 0 || y >= f.height) continue;
    const wy = Math.min(by, y + 1) - Math.max(ay, y);
    for (let x = Math.floor(ax); x < Math.ceil(bx); x++) {
      if (x < 0 || x >= f.width) continue;
      const w = wy * (Math.min(bx, x + 1) - Math.max(ax, x));
      sum += w * inkOf(px(f, x, y)); area += w;
    }
  }
  return area ? sum / area : 0;
}

// Tries a few sub-unit vertical offsets and keeps whichever reads cleanest - screenshots and
// odd GUI scales put the text a fraction of a pixel away from where the grid says.
function readLine(f, glyphs, top, unit, x0, x1) {
  let best = null;
  for (const d of [-0.5, -0.25, 0, 0.25, 0.5]) {
    const r = readLineAt(f, glyphs, top + d * unit, unit, x0, x1);
    if (!best || r.score < best.score) best = r;
  }
  return best;
}

function readLineAt(f, glyphs, top, unit, x0, x1) {
  const y0 = Math.max(0, Math.round(top)), y1 = Math.min(f.height, Math.round(top + 8 * unit));
  const colInk = [];
  for (let x = x0; x < x1; x++) { let ink = false; for (let y = y0; y < y1 && !ink; y++) ink = isInk(px(f, x, y)); colInk.push(ink); }
  // Split into glyphs on runs of empty columns (glyphs never touch: 1 font px of spacing).
  const runs = [];
  for (let i = 0; i < colInk.length;) {
    if (!colInk[i]) { i++; continue; }
    let j = i; while (j < colInk.length && colInk[j]) j++;
    runs.push({ x0: x0 + i, x1: x0 + j }); i = j;
  }
  const chars = runs.map((run) => classify(f, glyphs, run, top, unit));
  const text = chars.map((c) => c.ch).join('');
  const confidence = chars.length ? Math.min(...chars.map((c) => c.confidence)) : 0;
  const score = chars.reduce((a, c) => a + c.dist, 0) / Math.max(1, chars.length);
  return { text, confidence, chars, score };
}

function classify(f, glyphs, run, top, unit) {
  const w = run.x1 - run.x0;
  const scored = glyphs.map((g) => {
    // Resample the run onto this glyph's grid: each cell is "ink" if most of its area is.
    // Soft distance: how far each cell's ink coverage is from the glyph's on/off pixel.
    let miss = 0;
    const cw = w / g.width;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < g.width; c++) {
        const ink = cellInk(f, run.x0 + c * cw, run.x0 + (c + 1) * cw, top + r * unit, top + (r + 1) * unit);
        miss += Math.abs(ink - (g.bits[r][c] ? 1 : 0));
      }
    }
    // A glyph's rendered width should be close to width x unit; heavily penalise mismatches
    // so e.g. 'i' (1 px) can't be confused with 'l' (2 px) or 'I' (3 px).
    const ratio = w / (g.width * unit);
    const widthPenalty = Math.max(0, Math.abs(Math.log(ratio)) - 0.2) * 2;
    return { ch: g.ch, dist: miss / (8 * g.width) + widthPenalty };
  }).sort((a, b) => a.dist - b.dist);
  const best = scored[0], second = scored[1];
  // Measured on real captures: genuine matches score 0.01-0.2, a character that isn't in a
  // name at all (e.g. an apostrophe) ~0.5. Anything past MAX_CHAR_DIST is "can't read this".
  return { ch: best.ch, dist: best.dist, runnerUp: second.ch, confidence: Math.max(0, 1 - best.dist / MAX_CHAR_DIST) };
}

// Full pipeline. frame must be the game's client area. Returns { ok, name, confidence, book }
// or { ok: false, reason }.
function readRolledName(frame, glyphs) {
  const book = findBook(frame);
  if (!book) return { ok: false, reason: 'book not found' };
  const line = readLine(frame, glyphs, book.lineTop(2), book.unit, book.textX0, book.textX1);
  if (!/^[A-Za-z0-9_]{3,16}$/.test(line.text) || line.chars.some((c) => c.dist > MAX_CHAR_DIST)) return { ok: false, reason: 'no readable name', book, line };
  return { ok: true, name: line.text, confidence: line.confidence, book };
}

module.exports = { loadFont, findBook, readLine, readRolledName, NAME_CHARS, MAX_CHAR_DIST };
