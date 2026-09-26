'use strict';
// Human-like pacing tests: delays, click points and mouse paths. Run: npm test
const assert = require('assert');
const { nextDelay, pickClickPoint, planPath, MIN_DELAY_MS } = require('../src/main/humanMouse');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ok  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' -> ' + e.message); } }

t('delay stays in [min, max] and actually varies', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) { const d = nextDelay(1200, 2200); assert.ok(d >= 1200 && d <= 2200, d); seen.add(d); }
  assert.ok(seen.size > 100, 'not random enough: ' + seen.size);
});
t('delay can never go below the safety floor', () => {
  for (let i = 0; i < 100; i++) assert.ok(nextDelay(0, 10) >= MIN_DELAY_MS);
  assert.strictEqual(nextDelay(900, 500), 900); // max < min -> fixed at min
});
t('click points stay inside the link and vary', () => {
  const box = { x0: 552, y0: 144, x1: 649, y1: 157 };
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const p = pickClickPoint(box);
    assert.ok(p.x > box.x0 && p.x < box.x1 && p.y >= box.y0 && p.y <= box.y1, JSON.stringify(p));
    seen.add(p.x + ',' + p.y);
  }
  assert.ok(seen.size > 50, 'too few distinct points: ' + seen.size);
});
t('paths start near the cursor, end exactly on target, no teleport-sized jumps', () => {
  for (let i = 0; i < 300; i++) {
    const from = { x: Math.round(Math.random() * 2000), y: Math.round(Math.random() * 1200) };
    const to = { x: Math.round(Math.random() * 2000), y: Math.round(Math.random() * 1200) };
    const { dt, points } = planPath(from, to, { minMs: 180, maxMs: 420 });
    assert.deepStrictEqual(points[points.length - 1], to);
    assert.ok(dt >= 8 && dt <= 14);
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    let prev = from;
    for (const p of points) { assert.ok(Math.hypot(p.x - prev.x, p.y - prev.y) <= Math.max(40, dist / 3), 'jump too big'); prev = p; }
    assert.ok(points.length <= 400, 'too many points for the helper');
  }
});
t('duration respects the configured range', () => {
  for (let i = 0; i < 200; i++) {
    const { dt, points } = planPath({ x: 0, y: 0 }, { x: 500, y: 300 }, { minMs: 200, maxMs: 300 });
    const ms = dt * points.length;
    assert.ok(ms >= 200 * 0.75 * 0.6 && ms <= 300 * 1.3, 'duration ' + ms);
  }
});
t('no two paths are the same', () => {
  const sig = new Set();
  for (let i = 0; i < 50; i++) sig.add(JSON.stringify(planPath({ x: 100, y: 800 }, { x: 900, y: 150 }).points));
  assert.strictEqual(sig.size, 50);
});
t('paths curve (not a straight ruler line)', () => {
  let curved = 0;
  for (let i = 0; i < 100; i++) {
    const { points } = planPath({ x: 0, y: 0 }, { x: 800, y: 0 });
    if (points.some((p) => Math.abs(p.y) >= 8)) curved++;
  }
  assert.ok(curved > 80, 'only ' + curved + '/100 curved');
});
t('tiny moves are just the target', () => {
  assert.deepStrictEqual(planPath({ x: 10, y: 10 }, { x: 11, y: 10 }).points, [{ x: 11, y: 10 }]);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
