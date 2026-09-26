'use strict';
// Notification cards + sounds. This window is click-through and never focused (see
// notifications.js); everything here is display-only. Chat text from other players is untrusted
// and only ever goes in via textContent.
const api = window.solarBridge;
const $stack = document.getElementById('stack');
const MAX_CARDS = 4;

const KINDS = {
  nickMatch:     { color: '#bc8cff', icon: 'dice' },
  mention:       { color: '#58a6ff', icon: 'at' },
  dm:            { color: '#58a6ff', icon: 'mail' },
  partyInvite:   { color: '#3fb950', icon: 'party' },
  friendRequest: { color: '#3ddc97', icon: 'userPlus' },
  threat:        { color: '#f85149', icon: 'alert' },
  nameWatch:     { color: '#bc8cff', icon: 'sparkle' },
};
const RANKCOLOR = { SUPERSTAR: '#ffaa00', MVP_PLUS: '#55ffff', MVP: '#55ffff', VIP_PLUS: '#55ff55', VIP: '#55ff55', YOUTUBER: '#ff5555', ADMIN: '#ff5555' };

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
function fmt(n) { n = +n || 0; if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'; if (n >= 1e4) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'k'; return n.toLocaleString('en-US'); }
const fixed = (n) => (n == null ? '—' : (+n).toFixed(2));

// ---------- sounds (synthesised - no audio files) ----------
let ctx = null;
function tone(freq, start, dur, vol, type = 'sine') {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.value = freq;
  const t = ctx.currentTime + start;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t); o.stop(t + dur + 0.05);
}
const SOUNDS = {
  nickMatch: (v) => { [784, 988, 1175, 1568].forEach((f, i) => tone(f, i * 0.075, 0.5, v * 0.5)); tone(2349, 0.3, 0.6, v * 0.12); },
  mention:   (v) => { tone(880, 0, 0.22, v * 0.5); tone(1319, 0.11, 0.35, v * 0.45); },
  dm:        (v) => { tone(1047, 0, 0.18, v * 0.4); tone(1397, 0.08, 0.28, v * 0.35); },
  partyInvite: (v) => { tone(659, 0, 0.2, v * 0.4); tone(988, 0.1, 0.3, v * 0.4); },
  friendRequest: (v) => tone(988, 0, 0.3, v * 0.35),
  threat:    (v) => { tone(220, 0, 0.16, v * 0.55, 'triangle'); tone(220, 0.2, 0.2, v * 0.55, 'triangle'); tone(330, 0.2, 0.2, v * 0.25); },
  nameWatch: (v) => { tone(1319, 0, 0.25, v * 0.35); tone(1976, 0.09, 0.4, v * 0.3); },
};
function play(kind, volume) {
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    (SOUNDS[kind] || SOUNDS.friendRequest)(Math.max(0.0002, volume));
  } catch (_) { /* audio is a nicety; never break a notification over it */ }
}

// ---------- cards ----------
const cards = new Map(); // id -> { node, timer }

function statsBlock(card, s) {
  card.querySelectorAll('.who,.stats,.tags,.nicked').forEach((n) => n.remove());
  const anchor = card.querySelector('.head');
  const frag = document.createDocumentFragment();
  const who = el('div', 'who');
  if (s && s.star != null) { const st = el('span', 'star', s.star + '✫'); st.style.color = s.starColor || '#aaa'; who.appendChild(st); }
  const nm = el('span', 'name', (s && s.name) || card.dataset.player);
  nm.style.color = (s && RANKCOLOR[s.rank]) || 'var(--text)';
  who.appendChild(nm);
  if (s && s.sniper && s.sniper.score != null) { const sn = el('span', 'sn', String(s.sniper.score)); sn.style.color = s.sniper.color; sn.title = s.sniper.label; who.appendChild(sn); }
  frag.appendChild(who);
  if (s && s.nicked) frag.appendChild(el('div', 'nicked', 'Nicked - real identity unknown'));
  else {
    const grid = el('div', 'stats' + (s ? '' : ' loading'));
    for (const [k, v] of [['FKDR', s ? fixed(s.fkdr) : '…'], ['WLR', s ? fixed(s.wlr) : '…'], ['Finals', s ? fmt(s.finals) : '…'], ['WS', s ? (s.ws == null ? '—' : s.ws) : '…']]) {
      const c = el('div', 'stat'); c.appendChild(el('div', 'k', k)); c.appendChild(el('div', 'v', String(v))); grid.appendChild(c);
    }
    frag.appendChild(grid);
  }
  if (s && s.tags && s.tags.length) {
    const tags = el('div', 'tags');
    for (const t of s.tags.slice(0, 4)) { const tg = el('span', 'tag', t.label); tg.style.background = t.color; tags.appendChild(tg); }
    frag.appendChild(tags);
  }
  anchor.after(frag);
}

function dismiss(id) {
  const c = cards.get(id);
  if (!c) return;
  cards.delete(id);
  clearTimeout(c.timer);
  c.node.classList.add('out');
  setTimeout(() => { c.node.remove(); if (!cards.size) api.notifyIdle(); }, 260);
}

function show(n) {
  if (n.sound) play(n.kind, n.volume);
  if (!n.popup) return;
  const pos = n.position || 'bottom-right';
  document.body.className = (pos.startsWith('top') ? 'top ' : 'bottom ') + (pos.endsWith('left') ? 'left' : 'right');
  const k = KINDS[n.kind] || KINDS.friendRequest;
  const card = el('div', 'card');
  card.style.setProperty('--k', k.color);
  card.dataset.player = n.player || '';

  const head = el('div', 'head');
  const ic = el('span', 'ic'); ic.innerHTML = (window.SolarIcons && SolarIcons[k.icon]) || ''; // static trusted SVG
  head.appendChild(ic); head.appendChild(el('span', '', n.title)); head.appendChild(el('span', 'when', 'now'));
  card.appendChild(head);

  if (n.kind === 'nickMatch') card.appendChild(el('div', 'big', n.player || ''));
  else if (n.player) { statsBlock(card, n.stats); }
  if (n.text) card.appendChild(el('div', 'text' + (n.kind === 'mention' || n.kind === 'dm' ? ' quote' : ''), n.text));

  const timer = el('div', 'timer'); timer.style.animationDuration = n.durationMs + 'ms';
  card.appendChild(timer);
  $stack.appendChild(card);

  cards.set(n.id, { node: card, timer: setTimeout(() => dismiss(n.id), n.durationMs) });
  // Keep the stack short: the oldest card makes room.
  while (cards.size > MAX_CARDS) dismiss(cards.keys().next().value);
}

api.onNotify(show);
api.onNotifyUpdate(({ id, stats }) => { const c = cards.get(id); if (c && stats) statsBlock(c.node, stats); });
