'use strict';
// Launch animation "Sunrise" (see splash.css for the visuals): spark -> sun -> orbit -> rays ->
// wordmark -> lift-off, about 3.6s. This script only adds the sound, the live "which client"
// line and the hand-off to the overlay.
const api = window.solarBridge;
const HOLD_MS = 3300; // on screen before the fade-out (matches the timings in splash.css)
const FADE_MS = 450;

api.appInfo().then((i) => { document.getElementById('ver').textContent = 'v' + i.version; }).catch(() => {});

// "OneClient detected" / "Lunar Client detected" / "Waiting for Minecraft" - from the same status
// the overlay shows, so the very first screen already tells you Solar found your game.
const status = document.getElementById('status');
const paint = (st) => {
  const name = st && st.clientName;
  status.className = name ? 'ok' : '';
  status.querySelector('span').textContent = name ? name + ' detected' : 'Waiting for Minecraft';
};
api.getGameStatus().then(paint).catch(() => status.classList.add('none'));
if (api.onGameStatus) api.onGameStatus(paint);

// ---------- soundtrack (synthesised, on the same timeline as the visuals) ----------
// a low swell as the spark lights -> a soft round "bloom" as the sun appears (0.45s) -> a bright,
// open chord as the rays break out (1.2s), ringing into the wordmark. Uses the notification volume.
function soundtrack(volume, ac = new AudioContext()) {
  const t0 = ac.currentTime + 0.05;
  const limit = ac.createDynamicsCompressor();
  limit.threshold.value = -6; limit.knee.value = 6; limit.ratio.value = 12; limit.attack.value = 0.002; limit.release.value = 0.2;
  const master = ac.createGain(); master.gain.value = volume; master.connect(limit); limit.connect(ac.destination);
  // A little room: two damped feedback delays.
  const wet = ac.createGain(); wet.gain.value = 0.3; wet.connect(master);
  for (const [time, fb] of [[0.11, 0.38], [0.19, 0.32]]) {
    const d = ac.createDelay(1); d.delayTime.value = time;
    const g = ac.createGain(); g.gain.value = fb;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
    wet.connect(d); d.connect(lp); lp.connect(g); g.connect(d); lp.connect(master);
  }
  const out = (node, send) => { node.connect(master); const s = ac.createGain(); s.gain.value = send; node.connect(s); s.connect(wet); };
  const env = (g, at, peak, attack, release) => {
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + release);
  };
  const osc = (type, f, at, dur, peak, attack, release, send, detune = 0) => {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = f; o.detune.value = detune;
    env(g, at, peak, attack, release); o.connect(g); out(g, send);
    o.start(at); o.stop(at + dur);
  };
  // swell: a soft low fifth fading in under the spark
  for (const [f, d] of [[110, -4], [164.8, 3], [220, 0]]) {
    const o = ac.createOscillator(), g = ac.createGain(), lp = ac.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = d;
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(220, t0); lp.frequency.exponentialRampToValueAtTime(1100, t0 + 1.2); lp.frequency.exponentialRampToValueAtTime(400, t0 + 2.8);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.9); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 3);
    o.connect(lp); lp.connect(g); out(g, 0.5); o.start(t0); o.stop(t0 + 3.1);
  }
  // bloom: the sun appearing - a round, quick-falling sine "pop"
  const b = ac.createOscillator(), bg = ac.createGain(), bt = t0 + 0.45;
  b.type = 'sine'; b.frequency.setValueAtTime(330, bt); b.frequency.exponentialRampToValueAtTime(165, bt + 0.35);
  env(bg, bt, 0.22, 0.01, 0.5); b.connect(bg); out(bg, 0.35); b.start(bt); b.stop(bt + 0.6);
  // rays: an open A major 9 chord, struck note by note like the rays
  const rt = t0 + 1.18;
  [880, 1108.7, 1318.5, 1661.2, 1975.5].forEach((f, i) => {
    const at = rt + i * 0.04;
    osc('sine', f, at, 2.6, 0.075 - i * 0.008, 0.006, 2.2, 0.85);
    osc('triangle', f / 2, at, 1.4, 0.03, 0.01, 1.1, 0.5, 4);
  });
  if (ac.close) setTimeout(() => ac.close().catch(() => {}), 5000);
}
api.getConfig().then((cfg) => {
  const n = cfg.notifications || {};
  if (n.startupSound === false) return;
  soundtrack(Math.max(0, Math.min(1, Number(n.volume ?? 0.6))) * 0.9);
}).catch(() => {});

setTimeout(() => {
  document.getElementById('card').classList.add('leaving');
  setTimeout(() => api.splashDone(), FADE_MS);
}, HOLD_MS);
