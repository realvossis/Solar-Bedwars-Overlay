'use strict';
// Human-like pacing for the nick roller: randomized delays, click points, and mouse paths.
// Every call draws fresh randomness, so no two rolls move, pause or click the same way. Pure
// (randomness is injectable), so test/humanMouse.test.js can check the shapes.
//
// Note: Hypixel's server never sees the cursor - clicking a book link only sends a command. The
// path is for how it looks and feels on your screen; the delay is what shapes the timing.

const MIN_DELAY_MS = 700;

const lerp = (a, b, t) => a + (b - a) * t;
const uniform = (rand, a, b) => a + (b - a) * rand();
// Roughly bell-shaped in [-1, 1]: humans aim for the middle and miss a little, rarely a lot.
const bell = (rand) => (rand() + rand() + rand()) / 1.5 - 1;

// Pause before the next roll: uniform in [min, max], never below MIN_DELAY_MS.
function nextDelay(minMs, maxMs, rand = Math.random) {
  const lo = Math.max(MIN_DELAY_MS, Number(minMs) || 0);
  const hi = Math.max(lo, Number(maxMs) || 0);
  return Math.round(uniform(rand, lo, hi));
}

// A spot inside the link's box - biased toward the middle, never on its edge.
function pickClickPoint(box, rand = Math.random) {
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  const hw = (box.x1 - box.x0) / 2, hh = (box.y1 - box.y0) / 2;
  return { x: Math.round(cx + bell(rand) * hw * 0.6), y: Math.round(cy + bell(rand) * hh * 0.5) };
}

function cubic(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

// Plans a path from `from` to `to`: a randomly bent (sometimes S-shaped) curve with ease-in/out
// timing, tiny hand jitter, and now and then a small overshoot that gets corrected. Duration is
// random in [minMs, maxMs], a bit longer for longer moves. Returns { dt, points } where points
// are whole pixels ending exactly on `to`, to be played back one every dt ms.
function planPath(from, to, { minMs = 180, maxMs = 420, rand = Math.random } = {}) {
  const dx = to.x - from.x, dy = to.y - from.y, dist = Math.hypot(dx, dy);
  if (dist < 2) return { dt: 10, points: [{ x: to.x, y: to.y }] };
  const lo = Math.max(40, Number(minMs) || 0), hi = Math.max(lo, Number(maxMs) || 0);
  const duration = uniform(rand, lo, hi) * (0.75 + 0.25 * Math.min(1, dist / 600));
  const dt = Math.round(uniform(rand, 8, 14));

  // Perpendicular unit vector: control points are pushed off the straight line along it.
  const nx = -dy / dist, ny = dx / dist;
  const bend = dist * uniform(rand, 0.04, 0.28) * (rand() < 0.5 ? -1 : 1);
  const sCurve = rand() < 0.3 ? -uniform(rand, 0.3, 0.9) : uniform(rand, 0.4, 1); // second control on the other side = S-curve
  const t1 = uniform(rand, 0.2, 0.4), t2 = uniform(rand, 0.6, 0.85);

  // Overshoot: aim slightly past the target, then a short corrective hop back.
  const overshoot = dist > 80 && rand() < 0.25;
  const over = overshoot ? Math.min(12, Math.max(3, dist * uniform(rand, 0.02, 0.05))) : 0;
  const end = { x: to.x + (dx / dist) * over, y: to.y + (dy / dist) * over };

  const c1 = { x: lerp(from.x, end.x, t1) + nx * bend, y: lerp(from.y, end.y, t1) + ny * bend };
  const c2 = { x: lerp(from.x, end.x, t2) + nx * bend * sCurve, y: lerp(from.y, end.y, t2) + ny * bend * sCurve };

  const mainMs = overshoot ? duration * 0.85 : duration;
  const steps = Math.max(4, Math.round(mainMs / dt));
  const ease = uniform(rand, 1.6, 2.6); // how sharply it speeds up / slows down
  const points = [];
  for (let i = 1; i <= steps; i++) {
    const s = i / steps;
    const t = s < 0.5 ? Math.pow(2 * s, ease) / 2 : 1 - Math.pow(2 * (1 - s), ease) / 2;
    const jitter = i < steps ? 0.7 : 0;
    points.push({
      x: Math.round(cubic(from.x, c1.x, c2.x, end.x, t) + bell(rand) * jitter),
      y: Math.round(cubic(from.y, c1.y, c2.y, end.y, t) + bell(rand) * jitter),
    });
  }
  if (overshoot) {
    const back = Math.max(3, Math.round((duration * 0.15) / dt));
    const last = points[points.length - 1];
    for (let i = 1; i <= back; i++) {
      const t = 1 - Math.pow(1 - i / back, 2);
      points.push({ x: Math.round(lerp(last.x, to.x, t)), y: Math.round(lerp(last.y, to.y, t)) });
    }
  }
  points[points.length - 1] = { x: to.x, y: to.y };
  // Drop consecutive duplicates (they'd just be dead time).
  return { dt, points: points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y) };
}

// A short, random hesitation between arriving on the link and clicking it.
const preClickPause = (rand = Math.random) => Math.round(uniform(rand, 40, 150));

module.exports = { nextDelay, pickClickPoint, planPath, preClickPause, MIN_DELAY_MS };
