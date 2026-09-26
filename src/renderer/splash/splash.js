'use strict';
// Launch animation: a nebula and deep star field, a spiral galaxy condensing out of stardust, its
// core igniting into the Solar sun (flash + shockwave + flare), planets swinging onto their orbits,
// then a hyperspace warp as it hands off to the overlay.
//
// Everything is drawn on one 2D canvas. The app renders on the CPU (GPU acceleration is off to keep
// the overlay out of Minecraft's pipeline), so the expensive parts - nebula, glows, corona - are
// pre-rendered once into sprites, per-frame work is mostly 1-2px fillRects with additive blending,
// and the particle count drops automatically if frames run slow.
const api = window.solarBridge;
api.appInfo().then((i) => { document.getElementById('ver').textContent = 'v' + i.version; }).catch(() => {});

// ---------- soundtrack (synthesised, scheduled against the same timeline as the visuals) ----------
// ambient swell under the forming galaxy -> sub boom + bell at ignition (2.05s) -> a pluck per
// planet -> rising whoosh into the warp. Uses the notification volume; Settings can turn it off.
function soundtrack(volume, ac = new AudioContext()) {
  const t0 = ac.currentTime + 0.05;
  // Master bus -> gentle compressor -> hard limiter, so the ignition hit can never clip.
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -20; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.25;
  const limit = ac.createDynamicsCompressor();
  limit.threshold.value = -3; limit.knee.value = 0; limit.ratio.value = 20; limit.attack.value = 0.001; limit.release.value = 0.1;
  const master = ac.createGain(); master.gain.value = volume; master.connect(comp); comp.connect(limit); limit.connect(ac.destination);
  // A little space around everything: two short feedback delays standing in for reverb.
  const wet = ac.createGain(); wet.gain.value = 0.28; wet.connect(master);
  for (const [time, fb] of [[0.13, 0.42], [0.21, 0.35]]) {
    const d = ac.createDelay(1); d.delayTime.value = time;
    const g = ac.createGain(); g.gain.value = fb;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    wet.connect(d); d.connect(lp); lp.connect(g); g.connect(d); lp.connect(master);
  }
  const out = (node, send = 0.5) => { node.connect(master); const s = ac.createGain(); s.gain.value = send; node.connect(s); s.connect(wet); };
  const env = (g, at, peak, attack, hold, release) => {
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + attack);
    g.gain.setValueAtTime(peak, at + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + hold + release);
  };
  const noise = (secs) => {
    const b = ac.createBuffer(1, Math.ceil(ac.sampleRate * secs), ac.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = ac.createBufferSource(); s.buffer = b; return s;
  };

  // Ambient pad: detuned saws through a slowly opening low-pass (A minor-ish), swelling from silence.
  const padF = ac.createBiquadFilter(); padF.type = 'lowpass'; padF.Q.value = 0.7;
  padF.frequency.setValueAtTime(180, t0); padF.frequency.exponentialRampToValueAtTime(1400, t0 + 2.0); padF.frequency.exponentialRampToValueAtTime(700, t0 + 5.8);
  const padG = ac.createGain(); env(padG, t0, 0.3, 1.9, 2.8, 1.6);
  padF.connect(padG); out(padG, 0.6);
  for (const [f, det] of [[110, -7], [110, 7], [164.8, -5], [220, 4], [261.6, -3]]) {
    const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
    const g = ac.createGain(); g.gain.value = 0.18; o.connect(g); g.connect(padF);
    o.start(t0); o.stop(t0 + 6.5);
  }
  // Stardust: scattered high glints while the galaxy condenses.
  const glints = [1760, 2093, 2349, 2637, 3136, 3520];
  for (let i = 0; i < 16; i++) {
    const at = t0 + 0.35 + Math.random() * 1.6, o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine'; o.frequency.value = glints[Math.floor(Math.random() * glints.length)];
    env(g, at, 0.03 + Math.random() * 0.03, 0.005, 0, 0.35); o.connect(g); out(g, 0.9);
    o.start(at); o.stop(at + 0.45);
  }
  // Riser into ignition: filtered noise sweeping up.
  const rise = noise(1.4), rf = ac.createBiquadFilter(), rg = ac.createGain();
  rf.type = 'bandpass'; rf.Q.value = 1.4; rf.frequency.setValueAtTime(300, t0 + 0.7); rf.frequency.exponentialRampToValueAtTime(5000, t0 + 2.05);
  env(rg, t0 + 0.7, 0.12, 1.3, 0, 0.05); rise.connect(rf); rf.connect(rg); out(rg, 0.3); rise.start(t0 + 0.7);

  // Ignition (2.05s): sub boom, noise crack, bright bell.
  const ig = t0 + 2.05;
  const sub = ac.createOscillator(), sg = ac.createGain();
  sub.type = 'sine'; sub.frequency.setValueAtTime(130, ig); sub.frequency.exponentialRampToValueAtTime(34, ig + 0.9);
  env(sg, ig, 0.42, 0.008, 0.05, 1.3); sub.connect(sg); out(sg, 0.15); sub.start(ig); sub.stop(ig + 1.6);
  const crack = noise(1.2), cf = ac.createBiquadFilter(), cg = ac.createGain();
  cf.type = 'lowpass'; cf.frequency.setValueAtTime(6000, ig); cf.frequency.exponentialRampToValueAtTime(200, ig + 1.0);
  env(cg, ig, 0.16, 0.004, 0.02, 0.9); crack.connect(cf); cf.connect(cg); out(cg, 0.6); crack.start(ig);
  for (const [f, v] of [[880, 0.07], [1318.5, 0.05], [1760, 0.035], [2637, 0.02]]) {
    const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine'; o.frequency.value = f;
    env(g, ig + 0.02, v, 0.006, 0, 2.4); o.connect(g); out(g, 0.8); o.start(ig); o.stop(ig + 2.6);
  }
  // A pluck as each planet arrives (matches PLANETS[].start).
  for (const [at, f] of [[2.55, 659.3], [2.8, 784], [3.05, 987.8]]) {
    const o = ac.createOscillator(), o2 = ac.createOscillator(), g = ac.createGain();
    o.type = 'triangle'; o.frequency.value = f; o2.type = 'sine'; o2.frequency.value = f * 2;
    env(g, t0 + at, 0.11, 0.004, 0, 0.9); o.connect(g); o2.connect(g); out(g, 0.8);
    o.start(t0 + at); o2.start(t0 + at); o.stop(t0 + at + 1); o2.stop(t0 + at + 1);
  }
  // Warp (4.85s): whoosh sweeping up into the fade.
  const wa = t0 + 4.85, whoosh = noise(1.3), wf = ac.createBiquadFilter(), wg = ac.createGain();
  wf.type = 'bandpass'; wf.Q.value = 2; wf.frequency.setValueAtTime(250, wa); wf.frequency.exponentialRampToValueAtTime(7000, wa + 1.1);
  env(wg, wa, 0.4, 0.9, 0, 0.3); whoosh.connect(wf); wf.connect(wg); out(wg, 0.5); whoosh.start(wa);
  if (ac.close) setTimeout(() => ac.close().catch(() => {}), 7500);
}
api.getConfig().then((cfg) => {
  const n = cfg.notifications || {};
  if (n.startupSound === false) return;
  soundtrack(Math.max(0, Math.min(1, Number(n.volume ?? 0.6))) * 0.9);
}).catch(() => {});

const HOLD_MS = 5800; // total time on screen before the fade-out hand-off (matches splash.css)
const FADE_MS = 550;

const canvas = document.getElementById('space');
const ctx = canvas.getContext('2d');
const DPR = Math.min(2, window.devicePixelRatio || 1);
const W = canvas.clientWidth, H = canvas.clientHeight;
canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
ctx.scale(DPR, DPR);
const CX = W / 2, CY = H * 0.4;
const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- helpers ----------
let seed = 20260926; // fixed seed: the same beautiful galaxy every launch
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) / 2;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const seg = (t, a, b) => clamp01((t - a) / (b - a));           // 0..1 progress of t through [a,b]
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const mix = (a, b, t) => a + (b - a) * t;
const mixRGB = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const sprite = (size, stops) => {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  return c;
};

// ---------- pre-rendered sprites ----------
const GLOW_WARM = sprite(128, [[0, 'rgba(255,244,220,1)'], [0.18, 'rgba(255,200,120,.75)'], [0.45, 'rgba(255,130,60,.18)'], [1, 'rgba(255,90,40,0)']]);
const GLOW_SOFT = sprite(64, [[0, 'rgba(255,255,255,.9)'], [0.3, 'rgba(200,210,255,.35)'], [1, 'rgba(160,170,255,0)']]);
const CORONA = sprite(256, [[0, 'rgba(255,250,235,1)'], [0.12, 'rgba(255,226,160,1)'], [0.2, 'rgba(255,170,80,.55)'], [0.4, 'rgba(255,110,60,.16)'], [0.7, 'rgba(200,80,160,.05)'], [1, 'rgba(120,60,200,0)']]);

// Nebula: a wide band of big soft colour clouds, rendered once, then drifted/rotated per frame.
const NEB = (() => {
  const w = Math.round(W * 1.6), h = Math.round(H * 1.6), c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.globalCompositeOperation = 'lighter';
  const palette = [[168, 70, 255], [70, 110, 255], [255, 70, 170], [40, 200, 220], [120, 60, 220]];
  for (let i = 0; i < 70; i++) {
    const t = rnd(), along = (t - 0.5) * w * 0.95;
    const x = w / 2 + along, y = h / 2 + along * -0.28 + gauss() * h * 0.16;
    const r = 40 + rnd() * 170, col = palette[Math.floor(rnd() * palette.length)], a = 0.025 + rnd() * 0.06;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${a})`);
    gr.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Dark dust lanes cut through it for depth.
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 18; i++) {
    const x = w * (0.2 + rnd() * 0.6), y = h / 2 + (x - w / 2) * -0.28 + gauss() * 30, r = 20 + rnd() * 60;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(0,0,0,.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return c;
})();

// ---------- star field (3 parallax layers) ----------
const STARS = Array.from({ length: 420 }, () => {
  const layer = rnd() < 0.6 ? 0 : rnd() < 0.7 ? 1 : 2;
  return { x: rnd() * W, y: rnd() * H, layer, size: [0.6, 1, 1.6][layer], speed: [3, 7, 14][layer],
    base: 0.25 + rnd() * 0.6, tw: 0.6 + rnd() * 2.2, ph: rnd() * 6.28, blue: rnd() };
});

// ---------- galaxy ----------
const ARMS = 3, R = Math.min(W, H) * 0.62, TILT = 0.36, PLANE = -0.32;
const COL = [[255, 244, 220], [255, 196, 120], [255, 120, 190], [160, 110, 255], [90, 160, 255]];
const colAt = (t) => { const f = clamp01(t) * (COL.length - 1), i = Math.min(COL.length - 2, Math.floor(f)); return mixRGB(COL[i], COL[i + 1], f - i); };
const GALAXY = Array.from({ length: 2600 }, (_, i) => {
  const t = Math.pow(rnd(), 0.75), r = (0.04 + t * 0.96) * R;
  const arm = i % ARMS;
  const scatter = gauss() * (0.42 - t * 0.2);
  const c = colAt(clamp01(t * 1.1 + gauss() * 0.08));
  return {
    t, r, a0: arm * (Math.PI * 2 / ARMS) + t * 3.4 + scatter,
    rJit: 1 + gauss() * 0.08,
    size: rnd() < 0.08 ? 1.8 : rnd() < 0.5 ? 1.2 : 0.8,
    rgb: `${c[0] | 0},${c[1] | 0},${c[2] | 0}`,
    alpha: 0.45 + rnd() * 0.55,
    // Birth: starts far out in the dust and falls into place, outer stars a touch later.
    fromR: r * (2.2 + rnd() * 1.6), fromA: rnd() * 6.28, delay: 0.25 + rnd() * 0.5 + t * 0.35,
    tw: rnd() * 6.28,
  };
});
const project = (a, r) => {
  const x = Math.cos(a) * r, y = Math.sin(a) * r * TILT;
  return [CX + x * Math.cos(PLANE) - y * Math.sin(PLANE), CY + x * Math.sin(PLANE) + y * Math.cos(PLANE)];
};

// ---------- planets ----------
const PLANETS = [
  { a: 62, speed: 1.35, ph: 0.4, size: 5, c1: '#ffd0a0', c2: '#c2410c', start: 2.55 },
  { a: 106, speed: 0.82, ph: 2.6, size: 7.2, c1: '#b8f3ff', c2: '#1d6fa3', ring: true, start: 2.8 },
  { a: 158, speed: 0.52, ph: 4.4, size: 9.6, c1: '#e9c8ff', c2: '#5b21b6', moon: true, start: 3.05 },
];
const ORBIT_TILT = 0.3, ORBIT_PLANE = -0.18;
const orbitPos = (a, rad) => {
  const x = Math.cos(a) * rad, y = Math.sin(a) * rad * ORBIT_TILT;
  return [CX + x * Math.cos(ORBIT_PLANE) - y * Math.sin(ORBIT_PLANE), CY + x * Math.sin(ORBIT_PLANE) + y * Math.cos(ORBIT_PLANE), Math.sin(a)];
};

function drawPlanet(p, x, y, scale, alpha) {
  const s = p.size * scale;
  if (s < 0.3) return;
  ctx.globalAlpha = alpha;
  // Lit from the sun: the gradient's bright spot sits on the side facing the centre.
  const dx = CX - x, dy = CY - y, d = Math.hypot(dx, dy) || 1;
  const lx = x + (dx / d) * s * 0.55, ly = y + (dy / d) * s * 0.55;
  const g = ctx.createRadialGradient(lx, ly, s * 0.1, x, y, s * 1.05);
  g.addColorStop(0, p.c1); g.addColorStop(0.55, p.c2); g.addColorStop(1, '#05060d');
  if (p.ring) { ctx.strokeStyle = 'rgba(190,235,255,.35)'; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.ellipse(x, y, s * 2.1, s * 0.62, -0.35, Math.PI, Math.PI * 2); ctx.stroke(); }
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill();
  if (p.ring) { ctx.strokeStyle = 'rgba(190,235,255,.55)'; ctx.beginPath(); ctx.ellipse(x, y, s * 2.1, s * 0.62, -0.35, 0, Math.PI); ctx.stroke(); }
  ctx.globalAlpha = 1;
}

// ---------- frame ----------
const t0 = performance.now();
let last = t0, stride = 1, slow = 0, frames = 0;

function frame(now) {
  const T = reduced ? 4.6 : (now - t0) / 1000;         // seconds since start
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  // Adaptive quality: if the machine struggles, draw every 2nd/3rd galaxy particle.
  if (++frames > 10) { slow = slow * 0.9 + (dt > 0.03 ? 1 : 0) * 0.1; stride = slow > 0.5 ? 3 : slow > 0.25 ? 2 : 1; }

  const warp = Math.pow(seg(T, 4.85, 6.0), 2);           // hyperspace exit
  const ignite = seg(T, 2.05, 2.35);                   // core -> sun
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  const bg = ctx.createRadialGradient(CX, CY, 0, CX, CY, W * 0.75);
  bg.addColorStop(0, '#0b0a1c'); bg.addColorStop(0.6, '#05060f'); bg.addColorStop(1, '#020208');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  ctx.globalCompositeOperation = 'lighter';

  // Nebula: fades in, drifts and turns very slowly.
  const nebA = seg(T, 0.1, 1.6) * (1 - warp * 0.6);
  if (nebA > 0) {
    ctx.save(); ctx.globalAlpha = nebA * 0.95;
    ctx.translate(CX, CY); ctx.rotate(-0.05 + T * 0.012); ctx.scale(1 + T * 0.012 + warp * 0.3, 1 + T * 0.012 + warp * 0.3);
    ctx.drawImage(NEB, -NEB.width / 2 - T * 4, -NEB.height / 2);
    ctx.restore(); ctx.globalAlpha = 1;
  }

  // Stars: parallax drift, twinkle; stretched into streaks during the warp.
  const starIn = seg(T, 0, 0.9);
  for (const s of STARS) {
    const x = ((s.x - T * s.speed) % W + W) % W, y = s.y;
    const tw = s.base * (0.65 + 0.35 * Math.sin(T * s.tw + s.ph)) * starIn;
    const c = s.blue > 0.7 ? '180,200,255' : s.blue < 0.12 ? '255,220,190' : '235,238,255';
    if (warp > 0) {
      const dx = x - CX, dy = y - CY, len = warp * warp * (60 + s.layer * 60);
      const d = Math.hypot(dx, dy) || 1;
      ctx.strokeStyle = `rgba(${c},${Math.min(1, tw + warp)})`; ctx.lineWidth = s.size;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (dx / d) * len, y + (dy / d) * len); ctx.stroke();
    } else {
      ctx.fillStyle = `rgba(${c},${tw})`; ctx.fillRect(x, y, s.size, s.size);
      if (s.layer === 2 && tw > 0.55) { ctx.globalAlpha = tw * 0.5; ctx.drawImage(GLOW_SOFT, x - 5, y - 5, 11, 11); ctx.globalAlpha = 1; }
    }
  }

  // Galaxy: condenses from stardust, spins (inner faster), dims into a backdrop once the sun lights.
  const galA = seg(T, 0.2, 1.2) * mix(1, 0.42, ignite) * (1 - warp);
  if (galA > 0) {
    for (let i = 0; i < GALAXY.length; i += stride) {
      const p = GALAXY[i];
      const born = easeOut(seg(T, p.delay, p.delay + 1.5));
      const spin = T * (0.55 / (0.22 + p.t)) * 0.35;
      const a = mix(p.fromA, p.a0, born) + spin;
      const r = mix(p.fromR, p.r * p.rJit, born) * (1 + warp * 1.5);
      const [x, y] = project(a, r);
      const al = p.alpha * galA * born * (0.75 + 0.25 * Math.sin(T * 3 + p.tw));
      if (al < 0.02 || x < -4 || y < -4 || x > W + 4 || y > H + 4) continue;
      ctx.fillStyle = `rgba(${p.rgb},${al})`;
      ctx.fillRect(x, y, p.size, p.size);
    }
    // Galactic core glow, swelling until ignition.
    const coreA = seg(T, 0.6, 2.0) * (1 - ignite) * galA;
    if (coreA > 0) { const s = mix(40, 90, seg(T, 0.6, 2.05)); ctx.globalAlpha = coreA; ctx.drawImage(GLOW_WARM, CX - s, CY - s, s * 2, s * 2); ctx.globalAlpha = 1; }
  }

  // Orbits draw themselves in, then planets arrive; the ones on the far side pass behind the sun.
  const sunA = ignite * (1 - warp * 0.4);
  const planetState = PLANETS.map((p) => {
    const inA = easeOut(seg(T, p.start, p.start + 0.9));
    const ang = p.ph + T * p.speed + (1 - inA) * -1.2;
    const [x, y, depth] = orbitPos(ang, p.a * (1 + warp * 1.8));
    return { p, inA, ang, x, y, depth };
  });
  ctx.globalCompositeOperation = 'source-over';
  for (const ps of planetState) {
    const draw = seg(T, ps.p.start - 0.35, ps.p.start + 0.6);
    if (draw <= 0) continue;
    ctx.strokeStyle = `rgba(170,180,255,${0.13 * (1 - warp)})`; ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.ellipse(CX, CY, ps.p.a, ps.p.a * ORBIT_TILT, ORBIT_PLANE, ps.p.ph - 1.2, ps.p.ph - 1.2 + Math.PI * 2 * easeInOut(draw));
    ctx.stroke();
  }
  const behind = planetState.filter((s) => s.depth < 0), front = planetState.filter((s) => s.depth >= 0);
  const planets = (list) => {
    for (const s of list) {
      if (s.inA <= 0) continue;
      const depthScale = 0.85 + 0.15 * (s.depth + 1) / 2; // a touch smaller on the far side
      drawPlanet(s.p, s.x, s.y, s.inA * depthScale, s.inA * (1 - warp));
      if (s.p.moon) {
        const ma = T * 2.4;
        const mx = s.x + Math.cos(ma) * s.p.size * 2.4, my = s.y + Math.sin(ma) * s.p.size * 0.9;
        ctx.globalAlpha = s.inA * (1 - warp); ctx.fillStyle = '#cfd4e6'; ctx.beginPath(); ctx.arc(mx, my, 1.6 * s.inA, 0, 6.29); ctx.fill(); ctx.globalAlpha = 1;
      }
    }
  };
  planets(behind);

  // The sun: corona, slowly turning rays (the logo's 8), a white-hot core.
  if (sunA > 0) {
    ctx.globalCompositeOperation = 'lighter';
    const pulse = 1 + 0.04 * Math.sin(T * 3.1);
    const cs = mix(20, 120, easeOut(ignite)) * pulse * (1 + warp * 1.4);
    ctx.globalAlpha = sunA; ctx.drawImage(CORONA, CX - cs, CY - cs, cs * 2, cs * 2);
    ctx.save(); ctx.translate(CX, CY); ctx.rotate(T * 0.25);
    ctx.strokeStyle = `rgba(255,205,130,${0.55 * sunA})`; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
    const rr = 17 * easeOut(ignite);
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * rr * 1.25, Math.sin(a) * rr * 1.25); ctx.lineTo(Math.cos(a) * rr * 1.7, Math.sin(a) * rr * 1.7); ctx.stroke();
    }
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    const core = ctx.createRadialGradient(CX - 3, CY - 3, 1, CX, CY, 11 * easeOut(ignite));
    core.addColorStop(0, '#fffaf0'); core.addColorStop(0.55, '#ffd27a'); core.addColorStop(1, '#ff8a3d');
    ctx.fillStyle = core; ctx.beginPath(); ctx.arc(CX, CY, 11 * easeOut(ignite), 0, 6.29); ctx.fill();
    ctx.globalAlpha = 1;
  }

  planets(front);

  // Ignition: white flash, anamorphic flare streak, and a shockwave ring racing outward.
  ctx.globalCompositeOperation = 'lighter';
  const flash = seg(T, 2.05, 2.16) * (1 - seg(T, 2.16, 2.5));
  if (flash > 0) {
    ctx.fillStyle = `rgba(255,236,210,${flash * 0.18})`; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = flash; ctx.drawImage(GLOW_WARM, CX - 160, CY - 160, 320, 320); ctx.globalAlpha = 1;
  }
  const flare = seg(T, 2.1, 2.3) * (1 - seg(T, 2.5, 4.2) * 0.75) * (1 - warp);
  if (flare > 0) {
    const fg = ctx.createLinearGradient(CX - W * 0.5, CY, CX + W * 0.5, CY);
    fg.addColorStop(0, 'rgba(120,150,255,0)'); fg.addColorStop(0.5, `rgba(255,236,210,${0.55 * flare})`); fg.addColorStop(1, 'rgba(120,150,255,0)');
    ctx.fillStyle = fg; ctx.fillRect(0, CY - 1.2, W, 2.4);
  }
  const shock = seg(T, 2.12, 2.95);
  if (shock > 0 && shock < 1) {
    const r = easeOut(shock) * W * 0.62;
    ctx.strokeStyle = `rgba(255,205,160,${0.55 * Math.pow(1 - shock, 1.6)})`; ctx.lineWidth = 3 * (1 - shock) + 0.3;
    ctx.beginPath(); ctx.ellipse(CX, CY, r, r * 0.42, PLANE, 0, 6.29); ctx.stroke();
    ctx.strokeStyle = `rgba(150,170,255,${0.3 * Math.pow(1 - shock, 2)})`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(CX, CY, r * 0.82, r * 0.34, PLANE, 0, 6.29); ctx.stroke();
  }

  ctx.globalCompositeOperation = 'source-over';
  if (!reduced && T < (HOLD_MS + FADE_MS) / 1000 + 0.2) requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

setTimeout(() => {
  document.getElementById('card').classList.add('leaving');
  setTimeout(() => api.splashDone(), FADE_MS);
}, reduced ? 1600 : HOLD_MS);
