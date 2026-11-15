'use strict';
const api = window.solarBridge;
let cfg = null;

const $ = (s) => document.querySelector(s);
const el = (t, c) => { const e = document.createElement(t); if (c) e.className = c; return e; };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function getPath(o, p) { return p.split('.').reduce((a, k) => (a == null ? a : a[k]), o); }
function patchOf(path, val) {
  const parts = path.split('.'); const root = {}; let cur = root;
  if (parts.some((p) => p === '__proto__' || p === 'constructor' || p === 'prototype')) return root;
  for (let i = 0; i < parts.length - 1; i++) { cur[parts[i]] = {}; cur = cur[parts[i]]; }
  cur[parts[parts.length - 1]] = val; return root;
}
async function set(path, val) { cfg = await api.setConfig(patchOf(path, val)); }
// Mirrors net.js on the main side (which enforces it); checked here too so the user gets told why.
function isSecureUrl(url) {
  try { const u = new URL(url.replace(/{{?w+}?}/g, 'x')); return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)); }
  catch (_) { return false; }
}

const COLLABELS = { source: 'Source', tag: 'Tag', star: 'Lvl', name: 'Player', fkdr: 'FKDR', wlr: 'WLR', finals: 'F.Kills', wins: 'Wins', ws: 'WS', hws: 'Peak WS', mfkdr: 'M.FKDR', sniper: 'Sniper', lastseen: 'Last Login', bl: 'BL' };

// A curated set of extra Hypixel stats, grouped by gamemode, that a user can flip on
// as columns without having to know the raw API field names themselves. All off by
// default. These just become ordinary custom columns under the hood (same dot-path
// mechanism as the "add your own" box below), keyed with a stable 'cat:' prefix so
// toggling one back on doesn't create a duplicate.
const STAT_CATALOG = {
  General: [
    { key: 'cat:networkExp', label: 'Network XP', path: 'networkExp' },
    { key: 'cat:karma', label: 'Karma', path: 'karma' },
    { key: 'cat:achievementPoints', label: 'Achievement Points', path: 'achievementPoints' },
    { key: 'cat:mostRecentGame', label: 'Last Game Played', path: 'mostRecentGameType' },
  ],
  Bedwars: [
    { key: 'cat:bw_kills', label: 'Kills', path: 'stats.Bedwars.kills_bedwars' },
    { key: 'cat:bw_deaths', label: 'Deaths', path: 'stats.Bedwars.deaths_bedwars' },
    { key: 'cat:bw_beds_broken', label: 'Beds Broken', path: 'stats.Bedwars.beds_broken_bedwars' },
    { key: 'cat:bw_beds_lost', label: 'Beds Lost', path: 'stats.Bedwars.beds_lost_bedwars' },
    { key: 'cat:bw_games', label: 'Games Played', path: 'stats.Bedwars.games_played_bedwars' },
    { key: 'cat:bw_coins', label: 'Coins', path: 'stats.Bedwars.coins' },
    { key: 'cat:bw_solo_wins', label: 'Solo Wins', path: 'stats.Bedwars.eight_one_wins_bedwars' },
    { key: 'cat:bw_solo_finals', label: 'Solo Final Kills', path: 'stats.Bedwars.eight_one_final_kills_bedwars' },
    { key: 'cat:bw_doubles_wins', label: 'Doubles Wins', path: 'stats.Bedwars.eight_two_wins_bedwars' },
    { key: 'cat:bw_doubles_finals', label: 'Doubles Final Kills', path: 'stats.Bedwars.eight_two_final_kills_bedwars' },
    { key: 'cat:bw_3v3_wins', label: '3v3 Wins', path: 'stats.Bedwars.four_three_wins_bedwars' },
    { key: 'cat:bw_4v4_wins', label: '4v4 Wins', path: 'stats.Bedwars.four_four_wins_bedwars' },
  ],
  Skywars: [
    { key: 'cat:sw_kills', label: 'Kills', path: 'stats.SkyWars.kills' },
    { key: 'cat:sw_deaths', label: 'Deaths', path: 'stats.SkyWars.deaths' },
    { key: 'cat:sw_wins', label: 'Wins', path: 'stats.SkyWars.wins' },
    { key: 'cat:sw_losses', label: 'Losses', path: 'stats.SkyWars.losses' },
    { key: 'cat:sw_winstreak', label: 'Win Streak', path: 'stats.SkyWars.win_streak' },
    { key: 'cat:sw_souls', label: 'Souls', path: 'stats.SkyWars.souls' },
    { key: 'cat:sw_coins', label: 'Coins', path: 'stats.SkyWars.coins' },
  ],
  Duels: [
    { key: 'cat:du_wins', label: 'Wins', path: 'stats.Duels.wins' },
    { key: 'cat:du_losses', label: 'Losses', path: 'stats.Duels.losses' },
    { key: 'cat:du_kills', label: 'Kills', path: 'stats.Duels.kills' },
    { key: 'cat:du_deaths', label: 'Deaths', path: 'stats.Duels.deaths' },
    { key: 'cat:du_winstreak', label: 'Win Streak', path: 'stats.Duels.current_winstreak' },
    { key: 'cat:du_best_winstreak', label: 'Best Win Streak', path: 'stats.Duels.best_overall_winstreak' },
    { key: 'cat:du_coins', label: 'Coins', path: 'stats.Duels.coins' },
  ],
  'Murder Mystery': [
    { key: 'cat:mm_wins', label: 'Wins', path: 'stats.MurderMystery.wins' },
    { key: 'cat:mm_kills', label: 'Kills', path: 'stats.MurderMystery.kills' },
    { key: 'cat:mm_murderer_wins', label: 'Murderer Wins', path: 'stats.MurderMystery.murderer_wins' },
    { key: 'cat:mm_detective_wins', label: 'Detective Wins', path: 'stats.MurderMystery.detective_wins' },
    { key: 'cat:mm_coins', label: 'Coins', path: 'stats.MurderMystery.coins' },
  ],
};

const THEMES = {
  solar:    { bg: '#0b0c10', headerBg: '#111318', text: '#eceef2', accent: '#ffb547', grid: '#1d2028' },
  midnight: { bg: '#0d1117', headerBg: '#161b22', text: '#e6edf3', accent: '#58a6ff', grid: '#21262d' },
  obsidian: { bg: '#000000', headerBg: '#0a0a0a', text: '#f0f0f0', accent: '#8b5cf6', grid: '#1a1a1a' },
  ocean:    { bg: '#0b1e2d', headerBg: '#0f2a3d', text: '#dbeafe', accent: '#22d3ee', grid: '#1e3a4d' },
  forest:   { bg: '#0c1a12', headerBg: '#10241a', text: '#dcfce7', accent: '#4ade80', grid: '#1a3325' },
  rose:     { bg: '#1a0d14', headerBg: '#24121c', text: '#fce7f3', accent: '#f472b6', grid: '#33202b' },
  light:    { bg: '#f6f8fa', headerBg: '#eaeef2', text: '#1f2328', accent: '#0969da', grid: '#d0d7de' },
};

// ---------- field factory ----------
function fieldRow(label, help, control) {
  const f = el('div', 'field');
  const l = el('div', 'l');
  l.innerHTML = `<div class="name">${esc(label)}</div>` + (help ? `<div class="help">${esc(help)}</div>` : '');
  const c = el('div', 'c'); c.appendChild(control);
  f.appendChild(l); f.appendChild(c); return f;
}
function toggle(path) {
  const w = el('label', 'sw'); const i = el('input'); i.type = 'checkbox'; i.checked = !!getPath(cfg, path);
  const s = el('span', 'slider'); w.appendChild(i); w.appendChild(s);
  i.onchange = () => set(path, i.checked);
  return w;
}
function text(path, ph, wide) {
  const i = el('input'); i.type = 'text'; i.value = getPath(cfg, path) ?? ''; if (ph) i.placeholder = ph;
  if (wide) i.style.width = '340px';
  i.onchange = () => set(path, i.value);
  return i;
}
// Secret fields (API keys): hidden by default, revealed only while the eye is held/toggled on.
function secretText(path, ph, wide) {
  const wrap = el('div', 'secret-wrap' + (wide ? ' wide' : ''));
  const i = el('input'); i.type = 'password'; i.autocomplete = 'off'; i.spellcheck = false;
  i.value = getPath(cfg, path) ?? ''; if (ph) i.placeholder = ph;
  i.onchange = () => set(path, i.value);
  const eye = el('button', 'eye-toggle'); eye.type = 'button'; eye.innerHTML = SolarIcons.eye; eye.title = 'Show/hide key';
  eye.onclick = (e) => {
    e.preventDefault();
    const showing = i.type === 'text';
    i.type = showing ? 'password' : 'text';
    eye.classList.toggle('on', !showing);
  };
  wrap.appendChild(i); wrap.appendChild(eye);
  wrap.inputEl = i;
  return wrap;
}
function number(path, min, max, step) {
  const i = el('input'); i.type = 'number'; i.value = getPath(cfg, path) ?? 0;
  if (min != null) i.min = min; if (max != null) i.max = max; if (step != null) i.step = step;
  i.onchange = () => set(path, +i.value);
  return i;
}
function range(path, min, max, step, mul = 1) {
  const wrap = el('div'); wrap.style.display = 'flex'; wrap.style.alignItems = 'center'; wrap.style.gap = '8px';
  const i = el('input'); i.type = 'range'; i.min = min; i.max = max; i.step = step; i.value = getPath(cfg, path) * mul;
  const v = el('span', 'rangeval'); v.textContent = (getPath(cfg, path)).toString();
  i.oninput = () => { v.textContent = (i.value / mul).toString(); };
  i.onchange = () => set(path, +i.value / mul);
  wrap.appendChild(i); wrap.appendChild(v); return wrap;
}
function select(path, opts) {
  const s = el('select'); for (const o of opts) { const op = el('option'); op.value = o.v; op.textContent = o.l; if (getPath(cfg, path) == o.v) op.selected = true; s.appendChild(op); }
  s.onchange = () => set(path, s.value);
  return s;
}
function color(path) {
  const i = el('input'); i.type = 'color'; i.value = (getPath(cfg, path) || '#000000').slice(0, 7);
  i.onchange = () => set(path, i.value);
  return i;
}

// ---------- tabs ----------
const TABS = {
  General: panelGeneral,
  'Game Client': panelClient,
  Triggers: panelTriggers,
  Notifications: panelNotifications,
  'Name Watch': panelNameWatch,
  'Nick Roller': panelNickRoller,
  'Chat & Dodge': panelChatDodge,
  'Discord Decoy': panelDecoy,
  'API Keys': panelApi,
  Connections: panelConnections,
  Columns: panelColumns,
  'Sniper Score': panelSniper,
  Appearance: panelAppearance,
  Performance: panelPerf,
  About: panelAbout,
};
const TAB_GROUPS = [
  ['Overlay', ['General', 'Game Client', 'Triggers', 'Notifications']],
  ['Tools', ['Name Watch', 'Nick Roller', 'Chat & Dodge', 'Discord Decoy']],
  ['Data', ['API Keys', 'Connections', 'Columns', 'Sniper Score']],
  ['App', ['Appearance', 'Performance', 'About']],
];

// The Settings window wears the same theme as the overlay.
function applyTheme() {
  const t = (cfg && cfg.theme) || {};
  const r = document.documentElement.style;
  r.setProperty('--bg', t.bg || '#0b0c10');
  r.setProperty('--header', t.headerBg || '#111318');
  r.setProperty('--text', t.text || '#eceef2');
  r.setProperty('--accent', t.accent || '#ffb547');
  r.setProperty('--grid', t.grid || '#1d2028');
  // Text on the accent colour: dark on light accents, white on dark ones.
  const hex = String(t.accent || '#ffb547').replace('#', '');
  const lum = (parseInt(hex.slice(0, 2), 16) * 299 + parseInt(hex.slice(2, 4), 16) * 587 + parseInt(hex.slice(4, 6), 16) * 114) / 1000;
  r.setProperty('--on-accent', lum > 150 ? '#1a1206' : '#ffffff');
}

function panelGeneral(p) {
  p.appendChild(header('General', 'Who the overlay is and how it identifies you.'));
  p.appendChild(fieldRow('Your IGN', 'Filled in automatically from your game log. The name the overlay reacts to (mentions, "hide self", etc.)', text('selfName', 'your username')));
  const aliases = el('input'); aliases.type = 'text'; aliases.style.width = '240px';
  aliases.value = (cfg.reactNames || []).join(', '); aliases.placeholder = 'alt1, alt2';
  aliases.onchange = () => set('reactNames', aliases.value.split(',').map((s) => s.trim()).filter(Boolean));
  p.appendChild(fieldRow('Extra alias names', 'Comma-separated. Overlay also reacts to these. Add your own nicks here too, so you aren\'t alerted about yourself as a nicked player.', aliases));
  p.appendChild(fieldRow('Hide yourself from the list', '', toggle('hideSelf')));
  p.appendChild(fieldRow('Hide nicked / unresolved players', '', toggle('hideNicked')));
}

const ago = (t) => { const s = Math.max(0, (Date.now() - t) / 1000); if (s < 60) return 'just now'; const m = s / 60; if (m < 60) return Math.floor(m) + ' min ago'; const h = m / 60; if (h < 24) return Math.floor(h) + ' h ago'; return Math.floor(h / 24) + ' d ago'; };

function panelClient(p) {
  p.appendChild(header('Game Client', 'Solar reads your Minecraft client\'s log to see who is in your lobby, your party and your chat. Lunar Client, OneClient, Badlion, vanilla and the usual launchers all work - and you can switch between them any time.'));

  // Live status: which client, which log, where you are.
  const hero = el('div', 'client-hero standalone');
  hero.innerHTML = '<div class="orb"></div><div><div class="t1"></div><div class="t2"></div></div><div class="live"><i class="livedot"></i><span></span></div>';
  hero.querySelector('.orb').innerHTML = SolarIcons.cube;
  p.appendChild(hero);
  const paint = (st) => {
    if (!hero.isConnected || !st) return;
    const ok = st.log && st.log.ok;
    hero.querySelector('.t1').textContent = st.clientName ? st.label : 'No client found yet';
    hero.querySelector('.t2').textContent = st.clientName
      ? (st.mode === 'auto' ? 'Picked automatically - Solar follows whichever client you play on.' : 'Fixed log file.')
      : 'Start Minecraft with any client; Solar picks it up within a few seconds.';
    hero.querySelector('.livedot').className = 'livedot ' + (ok ? 'ok' : st.clientName ? 'wait' : '');
    hero.querySelector('.live span').textContent = !st.clientName ? 'Waiting' : !ok ? 'Waiting for the log' : (st.place && st.place.label) || 'Connected';
  };
  api.getGameStatus().then(paint);
  const off = api.onGameStatus((st) => { if (hero.isConnected) paint(st); else off(); });

  p.appendChild(header('Which log', 'Automatic is right for almost everyone. Pick a specific log only if you run two clients at once and want to pin one.'));
  const seg = el('div', 'seg');
  const bAuto = el('button'); bAuto.textContent = 'Automatic';
  const bMan = el('button'); bMan.textContent = 'Choose a log';
  seg.appendChild(bAuto); seg.appendChild(bMan);
  p.appendChild(fieldRow('Mode', '', seg));
  const list = el('div', 'loglist');
  const manualWrap = el('div');
  manualWrap.appendChild(list);
  const browse = el('button', 'ghost'); browse.innerHTML = SolarIcons.file + '<span>Other file…</span>';
  browse.onclick = async () => { const r = await api.pickLog(); if (r) { toast('Reading ' + r.split(/[\\/]/).slice(-3).join('/'), 'ok'); refreshList(); } };
  manualWrap.appendChild(browse);
  p.appendChild(manualWrap);
  async function refreshList() {
    cfg = await api.getConfig();
    const manual = cfg.logMode === 'manual';
    bAuto.classList.toggle('on', !manual); bMan.classList.toggle('on', manual);
    manualWrap.classList.toggle('hidden', !manual);
    const logs = await api.detectedLogs();
    list.innerHTML = '';
    if (!logs.length) { const e = el('div', 'kv'); e.textContent = 'No client logs found on this PC yet.'; list.appendChild(e); }
    for (const l of logs.slice(0, 8)) {
      const it = el('div', 'logitem' + (manual && cfg.logPath === l.path ? ' on' : ''));
      it.innerHTML = '<span class="mark"></span><div style="min-width:0"><div class="cl"></div><div class="pa"></div></div><span class="ago"></span>';
      it.querySelector('.mark').innerHTML = manual && cfg.logPath === l.path ? SolarIcons.check : '';
      it.querySelector('.cl').textContent = l.label;
      it.querySelector('.pa').textContent = l.path;
      it.querySelector('.ago').textContent = ago(l.mtime);
      it.onclick = async () => { await api.useLog(l.path); refreshList(); };
      list.appendChild(it);
    }
  }
  bAuto.onclick = async () => { await api.useLog('auto'); refreshList(); toast('Following your active client', 'ok'); };
  bMan.onclick = () => { bMan.classList.add('on'); bAuto.classList.remove('on'); manualWrap.classList.remove('hidden'); };
  refreshList();

  p.appendChild(header('Detection', ''));
  p.appendChild(fieldRow('Read the game log', 'Off = Solar only shows players you add by hand.', toggle('logEnabled')));
  p.appendChild(fieldRow('Clear list on server change', 'Wipe the list when you leave/join a game.', toggle('clearOnServerChange')));
  p.appendChild(fieldRow('Clear on lobby join', '', toggle('clearOnLobbyJoin')));
  p.appendChild(fieldRow('Track anyone who talks in chat', 'Add any player who speaks in chat to the list, scoped to your actual match lobby (never the main hub or the shared matchmaking queue).', toggle('trackChatSpeakers')));

  const how = el('div', 'kv');
  how.innerHTML = '<b>Which game am I in?</b> Lunar Client reports it on its own. On OneClient and others, Solar reads Hypixel\'s own messages and, with a Hypixel API key, asks Hypixel which game you just joined (your <span class="pill">Online Status</span> must be visible in Hypixel\'s API settings). Without that, the overlay still works - it just learns it\'s Bed Wars when the game starts.';
  p.appendChild(how);
}

function panelTriggers(p) {
  p.appendChild(header('Triggers', 'Auto-flag players to your local watchlist when these happen. They also show live in the list.'));
  const t = [
    ['triggers.onNameInChat', 'Someone says your name in chat', 'Flags whoever mentions your IGN.'],
    ['triggers.onPartyJoin', 'A player joins your party', ''],
    ['triggers.onPartyInvite', 'A player invites you to a party', ''],
    ['triggers.onDirectMessage', 'A player DMs you (/msg)', ''],
    ['triggers.onFriendRequest', 'A player friend-requests you', ''],
  ];
  for (const [k, l, h] of t) p.appendChild(fieldRow(l, h, toggle(k)));
  p.appendChild(fieldRow('Watchlist tag type', 'Label applied to auto-flagged players.', select('autoTagType', [
    { v: 'info', l: 'info' }, { v: 'caution', l: 'caution' }, { v: 'sniper', l: 'sniper' }, { v: 'toxic', l: 'toxic' },
  ])));
  const clear = el('button', 'ghost'); clear.textContent = 'Clear local watchlist';
  clear.onclick = async () => { await set('watchlist', {}); toast('Watchlist cleared', 'ok'); };
  p.appendChild(fieldRow('Reset watchlist', 'Remove all locally auto-flagged players.', clear));
}

const NOTIFY_EVENTS = [
  ['nickMatch', 'Nick roller found a matching name'],
  ['mention', 'Someone says your name in chat'],
  ['dm', 'Direct message'],
  ['partyInvite', 'Party invite'],
  ['friendRequest', 'Friend request'],
  ['threat', 'Threat joins your lobby'],
  ['nicked', 'Nicked player joins your lobby'],
  ['dodge', 'Auto-dodge leaves a lobby'],
  ['nameWatch', 'Name Watch match'],
];
function panelNotifications(p) {
  p.appendChild(header('Notifications', 'Popups in a corner of your screen with a quick look at the player\'s stats, plus short sounds - for the moments worth knowing about mid-game.'));
  const note = el('div', 'note');
  const ni = el('span', 'ic'); ni.innerHTML = SolarIcons.info;
  const nt = el('div'); nt.textContent = 'Popups can never take focus from your game: they can\'t be clicked or activated and disappear on their own, so you won\'t get tabbed out mid-fight.';
  note.appendChild(ni); note.appendChild(nt);
  p.appendChild(note);

  p.appendChild(header('Popups & sound', ''));
  p.appendChild(fieldRow('Enable notifications', '', toggle('notifications.enabled')));
  p.appendChild(fieldRow('Position', 'Corner of the screen the overlay is on.', select('notifications.position', [
    { v: 'bottom-right', l: 'Bottom right' }, { v: 'bottom-left', l: 'Bottom left' }, { v: 'top-right', l: 'Top right' }, { v: 'top-left', l: 'Top left' },
  ])));
  p.appendChild(fieldRow('Show for (seconds)', '', number('notifications.durationSec', 2, 30, 1)));
  p.appendChild(fieldRow('Sounds', '', toggle('notifications.sound')));
  p.appendChild(fieldRow('Volume', 'Also used for the startup sound.', range('notifications.volume', 0, 1, 0.05, 1)));
  p.appendChild(fieldRow('Startup sound', 'Soundtrack for the launch animation.', toggle('notifications.startupSound')));
  p.appendChild(fieldRow('Threat alert: sniper score from', 'Also alerts for anyone blacklisted, regardless of score.', number('notifications.threatMinSniper', 20, 100, 5)));
  p.appendChild(fieldRow('Threat & nick alerts only in Bedwars', 'Off = also in Duels, SkyWars etc. (where nearly every opponent would trigger one).', toggle('notifications.bedwarsOnly')));
  const test = el('button', 'ghost'); test.textContent = 'Send test notifications';
  test.onclick = () => api.previewNotification();
  p.appendChild(fieldRow('Preview', 'Shows sample popups with sound.', test));
  p.appendChild(fieldRow('Test inside your game', 'Press Alt+T while playing (e.g. in F11 fullscreen): shows a test popup and records how Windows stacks the game and Solar\'s windows, so visibility problems can be pinned down.', el('span')));

  p.appendChild(header('Events', 'Choose, per event, whether it shows a popup and/or plays a sound. With the popup off, you still get the small toast inside the overlay.'));
  const grid = el('div', 'evgrid');
  for (const h of ['Event', 'Popup', 'Sound']) grid.appendChild(el('div', 'h')).textContent = h;
  for (const [key, label] of NOTIFY_EVENTS) {
    grid.appendChild(el('div', 'n')).textContent = label;
    for (const kind of ['popup', 'sound']) { const c = el('div', 't'); c.appendChild(toggle(`notifications.events.${key}.${kind}`)); grid.appendChild(c); }
  }
  p.appendChild(grid);
}

function panelChatDodge(p) {
  p.appendChild(header('Chat & Dodge', 'Let Solar type into Minecraft\'s chat for you: warn your party about flagged players, prepare a public warning, or leave a lobby automatically.'));
  const note = el('div', 'note');
  const ni = el('span', 'ic'); ni.innerHTML = SolarIcons.info;
  const nt = el('div'); nt.textContent = 'Solar only types while Minecraft has been your focused window for a moment, waits until you let go of any key or mouse button, and stops the instant you tab out. It never types into another program. Windows only.';
  note.appendChild(ni); note.appendChild(nt); p.appendChild(note);

  p.appendChild(header('Warn your party', 'One party-chat message per flagged player, only in the Bedwars pre-game lobby and only when you\'re in a party. Sent automatically.'));
  p.appendChild(fieldRow('Auto-warn party', 'Off by default.', toggle('chatWarn.partyAuto')));
  p.appendChild(fieldRow('Max messages per lobby', 'Keeps it well clear of Hypixel\'s spam filter.', number('chatWarn.maxPartyPerLobby', 1, 8, 1)));
  p.appendChild(fieldRow('Also warn after the game starts', 'Pre-game names are scrambled, so after the start Solar waits for your first /who, then sends ONE combined party message listing the flagged players, e.g. "Flagged: A (Blatant Cheater); B (sniper score 88)". Only when you\'re not holding any key; dropped after 20s instead of interrupting a fight.', toggle('chatWarn.afterStart')));
  const partyTpl = text('chatWarn.partyTemplate', '[Solar] {name}: {tag} - {reason}', true);
  p.appendChild(fieldRow('Party message', 'Placeholders: {name} {tag} {reason} {sniper}. Sent as /pc …', partyTpl));

  p.appendChild(header('Public warning (Alt+W)', 'Press Alt+W in game: the warning for the next flagged player is typed into chat but NOT sent. You read it and press Enter, or Esc to drop it. Press Alt+W again for the next player.'));
  p.appendChild(fieldRow('Alt+W hotkey', '', toggle('chatWarn.hotkey')));
  const pubTpl = text('chatWarn.publicTemplate', 'Heads up: {name} is listed as {tag} - {reason}', true);
  p.appendChild(fieldRow('Public message', 'Placeholders: {name} {tag} {reason} {sniper}.', pubTpl));

  const prev = el('div', 'kv'); prev.style.cssText = 'font-family:Consolas,monospace;font-size:12px;line-height:1.7;margin-top:8px';
  async function refresh() {
    const r = await api.chatWarnPreview(partyTpl.value, pubTpl.value);
    prev.innerHTML = '<b>Preview</b> (long tag, fitted to Minecraft\'s 100-character limit):<br>' +
      `party&nbsp; <span class="ok">${esc(r.party)}</span> <span class="dim">(${r.party.length})</span><br>` +
      `public <span class="ok">${esc(r.public)}</span> <span class="dim">(${r.public.length})</span><br>` +
      `<span class="dim">Chat key read from your Minecraft options: code ${r.chatKey}${r.chatKey === 20 ? ' (T)' : ''}</span>`;
  }
  partyTpl.addEventListener('input', refresh); pubTpl.addEventListener('input', refresh);
  p.appendChild(prev); refresh();

  p.appendChild(header('Auto-dodge', 'Leave the Bedwars pre-game lobby automatically when someone crosses one of your limits. Once per lobby, never after the countdown\'s last second, never for you or your party. A popup tells you who triggered it.'));
  p.appendChild(fieldRow('Enable auto-dodge', 'Off by default.', toggle('autoDodge.enabled')));
  p.appendChild(fieldRow('Leave if someone is blacklisted', '', toggle('autoDodge.onTagged')));
  p.appendChild(fieldRow('Leave if FKDR is at least', '0 = off', number('autoDodge.fkdrAbove', 0, 100, 0.5)));
  p.appendChild(fieldRow('Leave if sniper score is at least', '0 = off', number('autoDodge.sniperAbove', 0, 100, 5)));
  p.appendChild(fieldRow('Leave if someone is nicked', '', toggle('autoDodge.onNicked')));
  const cmd = text('autoDodge.command', '/l bedwars');
  const cmdOut = el('span'); cmdOut.style.cssText = 'margin-left:8px;font-size:11.5px';
  const cmdRow = el('div'); cmdRow.style.cssText = 'display:flex;align-items:center'; cmdRow.appendChild(cmd); cmdRow.appendChild(cmdOut);
  cmd.addEventListener('input', async () => {
    const safe = await api.safeDodgeCommand(cmd.value);
    cmdOut.innerHTML = safe === cmd.value.trim() ? '<span class="ok">✓</span>' : `<span class="bad">will use ${esc(safe)}</span>`;
  });
  p.appendChild(fieldRow('Leave command', 'A plain slash command, e.g. /l bedwars or /play bedwars_eight_one. In a party, only the leader leaving takes everyone along.', cmdRow));

  p.appendChild(header("Knowing it's Bed Wars", "Party warnings and auto-dodge only act in a Bed Wars pre-game lobby. Lunar Client reports which game you joined; other clients (like OneClient) don't, so Solar first asks Hypixel's status API."));
  p.appendChild(fieldRow('Send /locraw when needed', "If the status API can't answer (no key, or your online status is hidden from the API), Solar sends /locraw once after you join a game - the same command Lunar sends - and reads the reply. Only while party warnings or auto-dodge are on.", toggle('locrawFallback')));
}

function panelDecoy(p) {
  p.appendChild(header('Discord Decoy', 'Shows a fake Lunar Client status on your Discord profile, with the real Lunar app, icons and wording, but only ever with Bed Wars games you are NOT in - whichever client you actually play on. A sniper reading your status queues into the wrong game right when you queue.'));
  const warn = el('div', 'note warn'); warn.style.display = 'none';
  const wi = el('span', 'ic'); wi.innerHTML = SolarIcons.alert;
  const wt = el('div');
  warn.appendChild(wi); warn.appendChild(wt); p.appendChild(warn);
  const RPC_WARN = {
    lunar: 'Lunar Client\'s own Discord Rich Presence is ON. It would show your real game next to the decoy. Turn it off in the Lunar launcher: Settings > Discord Rich Presence.',
    oneclient: 'OneClient\'s own Discord status is ON. It would show next to the decoy. Turn it off in the OneClient launcher: Settings > Discord RPC.',
  };

  p.appendChild(header('Decoy presence', 'Joining a Bed Wars game swaps in a new fake game at that exact moment. In lobbies and other games it shows Lunar\'s plain "Playing Hypixel". Cleared while Minecraft isn\'t running.'));
  p.appendChild(fieldRow('Enable decoy', 'Off by default. Needs the Discord desktop app running, with activity status on.', toggle('decoyPresence.enabled')));
  p.appendChild(fieldRow('Fake game', 'A different mode is safer: someone who queues your real mode at the same moment as you could still land in your lobby.', select('decoyPresence.style', [
    { v: 'other', l: 'Different mode and map' }, { v: 'mirror', l: 'Your mode, different map' },
  ])));

  p.appendChild(header('What Discord shows', 'Live preview, refreshed every few seconds.'));
  const card = el('div', 'rpc');
  card.innerHTML = '<div class="rpc-h">Playing</div><div class="rpc-b"><div class="rpc-art"><div class="rpc-lg">H</div><div class="rpc-sm"></div></div>' +
    '<div class="rpc-t"><div class="rpc-n">Lunar Client</div><div class="rpc-d"></div><div class="rpc-s"></div><div class="rpc-e"><svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M4.5 4h7a3.5 3.5 0 0 1 3.4 4.3l-.8 3.4a1.6 1.6 0 0 1-2.8.6L9.6 10.5H6.4l-1.7 1.8a1.6 1.6 0 0 1-2.8-.6l-.8-3.4A3.5 3.5 0 0 1 4.5 4zm.3 2v1.1H3.7v1h1.1v1.1h1V8.1h1.1v-1H5.8V6zm6.2.4a.7.7 0 1 0 0 1.4.7.7 0 0 0 0-1.4zm-1.3 1.4a.7.7 0 1 0 0 1.4.7.7 0 0 0 0-1.4z"/></svg><span></span></div></div></div>';
  const status = el('div', 'dim'); status.style.cssText = 'font-size:11.5px;margin:8px 0 6px';
  p.appendChild(card); p.appendChild(status);
  const q = (s) => card.querySelector(s);
  const clock = (ms) => { const t = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = String(t % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`; };
  let last = null;
  const paint = () => {
    const r = last || {};
    const on = [r.lunarRpcOn && RPC_WARN.lunar, r.oneClientRpcOn && RPC_WARN.oneclient].filter(Boolean);
    warn.style.display = on.length ? '' : 'none';
    wt.textContent = on.join(' ');
    const shown = r.enabled && r.discord && r.details;
    card.classList.toggle('off', !shown);
    q('.rpc-d').textContent = r.details || 'Playing Bed Wars on Hypixel';
    q('.rpc-s').textContent = r.state || '4v4v4v4 on Shipwreck';
    q('.rpc-e').style.visibility = r.startedAt ? '' : 'hidden';
    q('.rpc-e span').textContent = r.startedAt ? clock(Date.now() - r.startedAt) : '';
    status.innerHTML = !r.enabled ? 'Decoy is off - example of what it shows.'
      : !r.discord ? '<span class="bad">Discord not found</span> - open the Discord desktop app; Solar retries every 15s.'
      : !r.gameRunning ? '<span class="ok">Connected to Discord.</span> Nothing shown until Minecraft is running.'
      : '<span class="ok">Live on your Discord profile.</span>';
  };
  const refresh = async () => { try { last = await api.decoyStatus(); } catch (_) {} paint(); };
  refresh();
  const iv = setInterval(() => { if (!card.isConnected) { clearInterval(iv); return; } refresh(); }, 3000);
}

function panelNameWatch(p) {
  p.appendChild(header('Name Watch', 'Your own list of names or patterns. Every player on the overlay is checked against it; matches are highlighted in purple with a ✦ and (optionally) a toast.'));
  p.appendChild(fieldRow('Enable Name Watch', '', toggle('nameWatch.enabled')));
  p.appendChild(fieldRow('Notify on match', 'Toast when a matching player shows up.', toggle('nameWatch.notify')));

  const help = el('div', 'kv');
  help.innerHTML = 'One rule per line. <b>Plain text</b> matches anywhere in a name, ignoring case — <span class="pill">Cat</span> matches <i>xXCatLover</i>. ' +
    '<b>Regex</b> goes between slashes — <span class="pill">/^[a-z]{3,4}$/i</span> matches any 3–4 letter name. Lines starting with <span class="pill">#</span> are comments.';
  p.appendChild(help);

  const ta = el('textarea');
  ta.spellcheck = false;
  ta.style.cssText = 'width:100%;height:190px;margin-top:10px;font-family:Consolas,monospace;font-size:12px;box-sizing:border-box';
  ta.placeholder = '# e.g.\nCat\n/^[A-Z][a-z]+$/\n/^.{3}$/';
  ta.value = ((cfg.nameWatch || {}).rules || []).join('\n');
  const status = el('div', 'kv'); status.style.marginTop = '6px';
  const splitLines = (text) => String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const linesOf = () => splitLines(ta.value);

  // Live validation + test, both answered by the same engine the overlay runs.
  const testIn = el('input'); testIn.type = 'text'; testIn.placeholder = 'paste a name / nick to test'; testIn.style.width = '220px'; testIn.maxLength = 32;
  const testOut = el('span'); testOut.style.cssText = 'margin-left:10px;font-size:12px';
  async function refresh() {
    const r = await api.checkNameRules(linesOf(), testIn.value.trim());
    status.innerHTML = `<span class="ok">${r.valid} valid rule${r.valid === 1 ? '' : 's'}</span>` +
      r.errors.map((e) => `<div class="bad">✕ ${esc(e.source)} — ${esc(e.error)}</div>`).join('');
    if (!testIn.value.trim()) testOut.textContent = '';
    else if (r.hits.length) testOut.innerHTML = `<span class="ok">✓ match: ${esc(r.hits.join(', '))}</span>`;
    else testOut.innerHTML = '<span class="bad">no match</span>';
  }
  let t = null;
  ta.oninput = () => { clearTimeout(t); t = setTimeout(refresh, 250); };
  ta.onchange = async () => { await set('nameWatch.rules', linesOf()); toast('Name Watch rules saved', 'ok'); };
  testIn.oninput = refresh;
  p.appendChild(ta); p.appendChild(status);

  // Import a word list (.txt, one entry per line) - read locally in this window, never uploaded.
  const file = el('input'); file.type = 'file'; file.accept = '.txt,text/plain'; file.style.display = 'none';
  file.onchange = () => {
    const f = file.files && file.files[0]; if (!f) return;
    if (f.size > 256 * 1024) { toast('File too large (max 256 KB)', 'err'); return; }
    const rd = new FileReader();
    rd.onload = async () => {
      const merged = [...new Set([...linesOf(), ...splitLines(rd.result)])];
      ta.value = merged.join('\n'); await set('nameWatch.rules', linesOf()); refresh(); toast('Imported ' + f.name, 'ok');
    };
    rd.readAsText(f); file.value = '';
  };
  const imp = el('button', 'ghost'); imp.textContent = 'Import .txt list…'; imp.onclick = () => file.click();
  const clr = el('button', 'ghost'); clr.textContent = 'Clear all'; clr.style.marginLeft = '8px';
  clr.onclick = async () => { ta.value = ''; await set('nameWatch.rules', []); refresh(); };
  const btns = el('div'); btns.style.marginTop = '8px'; btns.appendChild(imp); btns.appendChild(clr); btns.appendChild(file);
  p.appendChild(btns);

  const testRow = el('div'); testRow.style.cssText = 'display:flex;align-items:center';
  testRow.appendChild(testIn); testRow.appendChild(testOut);
  p.appendChild(fieldRow('Test a name', 'Rolling a nick by hand? Paste it here to see instantly if it hits your list.', testRow));
  refresh();
}

function panelNickRoller(p) {
  p.appendChild(header('Nick Roller', 'Rerolls Hypixel\'s random nick until one fits your requirements, then stops with the book open so you can click USE NAME yourself.'));
  const how = el('div', 'kv');
  how.style.lineHeight = '1.8';
  how.innerHTML = '<b>How to use:</b> in game type <span class="pill">/nick</span> → I understand → pick a rank → pick a skin → <b>Use a random name</b>. ' +
    'With that page open and Minecraft focused, press <span class="pill">Alt+N</span>. Press Alt+N again, click the 🎲 chip, or just move your mouse to stop.<br>' +
    'Needs borderless or windowed mode (exclusive fullscreen can\'t be captured). The overlay hides itself from the captures while rolling.';
  p.appendChild(how);
  const statusBox = el('div', 'kv'); statusBox.style.margin = '8px 0';
  p.appendChild(statusBox);

  p.appendChild(header('Requirements', 'A rolled name is taken when it passes every check below AND matches at least one of your rules (if you have any).'));
  p.appendChild(fieldRow('Min length', '0 = any', number('nickRoller.minLength', 0, 16, 1)));
  p.appendChild(fieldRow('Max length', '16 = any', number('nickRoller.maxLength', 3, 16, 1)));
  p.appendChild(fieldRow('No digits', '', toggle('nickRoller.noDigits')));
  p.appendChild(fieldRow('No underscores', '', toggle('nickRoller.noUnderscore')));
  p.appendChild(fieldRow('Also accept my Name Watch list', 'Use the rules from the Name Watch tab too.', toggle('nickRoller.useNameWatch')));

  const ta = el('textarea');
  ta.spellcheck = false;
  ta.style.cssText = 'width:100%;height:120px;margin-top:6px;font-family:Consolas,monospace;font-size:12px;box-sizing:border-box';
  ta.placeholder = 'One rule per line - same syntax as Name Watch:\nCat\n/^[A-Z][a-z]{3,6}$/';
  ta.value = ((cfg.nickRoller || {}).rules || []).join('\n');
  const splitLines = (text) => String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  p.appendChild(fieldRow('Rules', 'Plain text = contains (any case). /regex/ for anything fancier.', el('div')));
  p.appendChild(ta);

  const testIn = el('input'); testIn.type = 'text'; testIn.placeholder = 'try a name'; testIn.maxLength = 32; testIn.style.width = '200px';
  const testOut = el('span'); testOut.style.cssText = 'margin-left:10px;font-size:12px';
  const reqStatus = el('div', 'kv'); reqStatus.style.marginTop = '6px';
  async function refresh() {
    const r = await api.checkNickRoller(testIn.value.trim());
    reqStatus.innerHTML = (r.platform !== 'win32' ? '<div class="bad">The nick roller only works on Windows.</div>' : '') +
      (r.font.ok ? `<div class="ok">✓ Minecraft font found (${esc(r.font.jar)})</div>` : `<div class="bad">✕ ${esc(r.font.error)}</div>`) +
      (r.empty ? '<div class="bad">✕ No requirements yet - add a rule or enable a check.</div>' : '<div class="ok">✓ Requirements set</div>') +
      r.errors.map((e) => `<div class="bad">✕ ${esc(e.source)} — ${esc(e.error)}</div>`).join('');
    if (!r.result) testOut.textContent = '';
    else if (r.result.ok) testOut.innerHTML = '<span class="ok">✓ would stop here</span>';
    else testOut.innerHTML = `<span class="bad">✕ ${esc(r.result.why)}</span>`;
  }
  ta.onchange = async () => { await set('nickRoller.rules', splitLines(ta.value)); refresh(); };
  testIn.oninput = refresh;
  const testRow = el('div'); testRow.style.cssText = 'display:flex;align-items:center'; testRow.appendChild(testIn); testRow.appendChild(testOut);
  p.appendChild(fieldRow('Test a name', '', testRow));
  p.appendChild(reqStatus);
  // Re-check after any toggle/number on this tab changes.
  p.addEventListener('change', () => setTimeout(refresh, 80));

  p.appendChild(header('Pacing', 'Everything here is re-randomized on every roll, so no two rolls look or time the same.'));
  // A min–max pair on one row; if they cross, the other one follows.
  const rangeRow = (label, help, minPath, maxPath, lo, hi, step) => {
    const a = number(minPath, lo, hi, step), b = number(maxPath, lo, hi, step);
    a.style.width = b.style.width = '80px';
    const fix = async (src) => {
      const mn = +a.value, mx = +b.value;
      if (mx < mn) { if (src === a) { b.value = mn; await set(maxPath, mn); } else { a.value = mx; await set(minPath, mx); } }
    };
    a.addEventListener('change', () => fix(a)); b.addEventListener('change', () => fix(b));
    const w = el('div'); w.style.cssText = 'display:flex;align-items:center;gap:6px';
    const to = el('span'); to.textContent = 'to'; to.className = 'dim';
    w.appendChild(a); w.appendChild(to); w.appendChild(b);
    return fieldRow(label, help, w);
  };
  p.appendChild(rangeRow('Random delay between rolls (ms)', 'A new random wait in this range before every roll. Set both the same for a fixed delay. Never below 700.', 'nickRoller.delayMinMs', 'nickRoller.delayMaxMs', 700, 30000, 100));
  p.appendChild(fieldRow('Human-like mouse movement', 'Glide to TRY AGAIN along a curved path with its own speed each time (sometimes a slight overshoot and correction), then pause briefly before clicking. Off = the cursor jumps straight there.', toggle('nickRoller.humanMouse')));
  p.appendChild(rangeRow('Movement duration (ms)', 'How long each glide takes, picked at random in this range.', 'nickRoller.moveMinMs', 'nickRoller.moveMaxMs', 60, 2000, 20));
  p.appendChild(fieldRow('Random click point', 'Click a different spot inside the TRY AGAIN link each time instead of its exact centre.', toggle('nickRoller.randomClickPoint')));

  p.appendChild(header('Safety', ''));
  p.appendChild(fieldRow('Max rolls per run', '', number('nickRoller.maxRolls', 1, 5000, 10)));
  p.appendChild(fieldRow('Minecraft 1.8.9 jar (optional)', 'Only if the font isn\'t found automatically.', text('nickRoller.jarPath', '...\\.minecraft\\versions\\1.8.9\\1.8.9.jar', true)));

  const hist = el('div', 'kv'); hist.style.cssText = 'margin-top:10px;font-family:Consolas,monospace;font-size:11.5px;line-height:1.6';
  p.appendChild(header('Last run', '')); p.appendChild(hist);
  const show = (s) => {
    statusBox.innerHTML = s.running
      ? `<span class="ok">● Rolling…</span> ${s.rolls} rolls${s.last ? ' · last: <b>' + esc(s.last) + '</b>' : ''}`
      : `<span class="dim">Idle.</span> ${esc(s.message && s.message !== 'idle' ? s.message : '')}`;
    hist.innerHTML = (s.history || []).slice().reverse().map((h) => `<div class="${h.match ? 'ok' : ''}">${h.match ? '✓' : '·'} ${esc(h.name)}</div>`).join('') || '<span class="dim">No rolls yet.</span>';
  };
  api.nickRollerStatus().then(show);
  const off = api.onNickRoller((s) => { if (document.body.contains(hist)) show(s); else off(); });
  refresh();
}

function panelApi(p) {
  p.appendChild(header('API Keys', 'Your keys live here — easy to change. Nothing is shared externally except to the APIs themselves.'));
  const row = el('div'); row.style.display = 'flex'; row.style.gap = '8px'; row.style.alignItems = 'center';
  const t = secretText('hypixelKey', 'Hypixel API key', true); const b = el('button', 'act'); b.textContent = 'Test';
  const res = el('span'); res.style.fontSize = '11px';
  b.onclick = async () => { await set('hypixelKey', t.inputEl.value); res.textContent = 'testing…'; res.className = '';
    const r = await api.testKey();
    if (r.ok) { res.innerHTML = `<span class="ok">valid</span> · ${r.record && r.record.limit ? r.record.limit + '/5min' : 'ok'}`; }
    else { res.innerHTML = `<span class="bad">${esc(r.error)}</span>`; } };
  row.appendChild(t); row.appendChild(b); row.appendChild(res);
  p.appendChild(fieldRow('Hypixel API key', 'From developer.hypixel.net. Personal key = 300 req / 5 min.', row));

  p.appendChild(header('Urchin', 'Custom blacklist endpoint. Placeholders {id} {uuid} {name} {sources} are substituted per player.'));
  const ep = el('textarea'); ep.value = cfg.urchinEndpoint || ''; ep.style.width = '360px';
  ep.onchange = () => {
    if (ep.value.trim() && !isSecureUrl(ep.value.trim())) { toast('Endpoint must be https:// - your key would otherwise travel unencrypted', 'err'); ep.value = cfg.urchinEndpoint || ''; return; }
    set('urchinEndpoint', ep.value.trim());
  };
  p.appendChild(fieldRow('Cubelify endpoint URL', 'Placeholders {id} {uuid} {name} {key} {sources} are substituted per player.', ep));
  p.appendChild(fieldRow('Urchin key', 'Substituted into {key} in the endpoint above.', secretText('urchinKey', 'urchin key')));
  p.appendChild(fieldRow('Sources', 'Comma-separated Urchin sources.', text('urchinSources', '', true)));
  p.appendChild(fieldRow('Admin base URL', 'Base for admin add-tag (Blacklist tab).', text('urchinAdminBase', '', true)));
  p.appendChild(fieldRow('Admin key', 'Only needed for the Blacklist Admin tab (adding tags).', secretText('urchinAdminKey', 'admin key')));
}

// Every place a column's value can come from: Hypixel's own player object, or one of
// the user's Connections (the built-in Urchin one included, if it's switched on).
function availableSources() {
  const opts = [{ v: 'hypixel', l: 'Hypixel player stats' }];
  if (cfg.urchinEnabled !== false) opts.push({ v: 'urchin', l: 'Urchin (built-in)' });
  for (const conn of (cfg.connections || [])) opts.push({ v: conn.id, l: conn.name || conn.id });
  return opts;
}

function panelConnections(p) {
  p.appendChild(header('Connections', 'Every blacklist/tag source that feeds the overlay, in one place. Same {id} {uuid} {name} {key} {sources} placeholders everywhere. Each response should look like { "tags": [...] } (or just a bare array) — tags can be either the { tag_type, reason, added_by } shape or the { icon, color, tooltip } shape. Once a connection is added here, head to the Columns tab to map it onto Tag, M.FKDR, or any other column.'));
  const box = el('div');

  // Urchin ships built-in and on by default — listed here like any other connection
  // so it's obvious it's running, but it's just a toggle away from being turned off.
  const ub = el('div', 'colrow');
  const usw = toggle('urchinEnabled');
  const unm = el('span', 'cname'); unm.textContent = 'Urchin (built-in)';
  const uedit = el('button'); uedit.textContent = '✎'; uedit.title = 'Endpoint / key / sources live under API Keys';
  uedit.onclick = () => { active = 'API Keys'; rerender(); };
  ub.appendChild(usw); ub.appendChild(unm); ub.appendChild(uedit);
  box.appendChild(ub);

  const list = cfg.connections || [];
  list.forEach((conn, idx) => {
    const row = el('div', 'colrow');
    const sw = el('label', 'sw'); const i = el('input'); i.type = 'checkbox'; i.checked = conn.enabled !== false;
    const sl = el('span', 'slider'); sw.appendChild(i); sw.appendChild(sl);
    i.onchange = async () => { const next = list.slice(); next[idx] = { ...conn, enabled: i.checked }; await set('connections', next); };
    const nm = el('span', 'cname'); nm.textContent = conn.name || conn.id;
    const edit = el('button'); edit.textContent = '✎'; edit.title = 'Edit';
    edit.onclick = () => openConnEditor(conn, idx);
    const rm = el('button'); rm.textContent = '✕'; rm.title = 'Remove';
    rm.onclick = async () => { const next = list.filter((_, j) => j !== idx); await set('connections', next); rerender(); };
    row.appendChild(sw); row.appendChild(nm); row.appendChild(edit); row.appendChild(rm);
    box.appendChild(row);
  });
  p.appendChild(box);
  const add = el('button', 'act'); add.textContent = '+ Add connection';
  add.style.marginTop = '8px';
  add.onclick = () => openConnEditor(null, -1);
  p.appendChild(add);
}

function openConnEditor(conn, idx) {
  const back = el('div', 'modal-back');
  const box = el('div', 'modal');
  box.innerHTML = `<div class="m-title">${conn ? 'Edit' : 'Add'} connection</div>`;
  const name = el('input'); name.type = 'text'; name.placeholder = 'Name (e.g. MyBlacklist)';
  name.value = (conn && conn.name) || '';
  const endpoint = el('textarea'); endpoint.placeholder = 'https://example.com/api?uuid={id}&key={key}';
  endpoint.value = (conn && conn.endpoint) || '';
  const key = el('input'); key.type = 'password'; key.placeholder = 'API key (optional, fills {key})';
  key.value = (conn && conn.key) || '';
  box.appendChild(name); box.appendChild(endpoint); box.appendChild(key);
  const btns = el('div', 'm-btns');
  const cancel = el('button', 'ghost'); cancel.textContent = 'Cancel';
  const saveBtn = el('button', 'act'); saveBtn.textContent = 'Save';
  cancel.onclick = () => back.remove();
  saveBtn.onclick = async () => {
    if (!name.value.trim() || !endpoint.value.trim()) { toast('Name and endpoint are both required', 'err'); return; }
    if (!isSecureUrl(endpoint.value.trim())) { toast('Endpoint must start with https:// (plain http only for localhost)', 'err'); return; }
    const list = (cfg.connections || []).slice();
    const entry = {
      id: (conn && conn.id) || ('conn_' + Date.now().toString(36)),
      name: name.value.trim(), endpoint: endpoint.value.trim(), key: key.value,
      enabled: conn ? conn.enabled !== false : true,
    };
    if (idx >= 0) list[idx] = entry; else list.push(entry);
    cfg = await api.setConfig({ connections: list });
    back.remove(); rerender(); toast('Connection saved', 'ok');
  };
  btns.appendChild(cancel); btns.appendChild(saveBtn); box.appendChild(btns);
  back.appendChild(box); document.body.appendChild(back);
  back.onclick = (e) => { if (e.target === back) back.remove(); };
}

function panelAppearance(p) {
  p.appendChild(header('Appearance', 'Look and window behavior.'));
  const presets = el('div', 'presets');
  for (const [name, th] of Object.entries(THEMES)) {
    const d = el('div', 'preset' + ((cfg.theme || {}).name === name ? ' on' : ''));
    d.innerHTML = `<span class="swatch" style="background:${th.bg}"><i style="background:${th.accent}"></i></span>${name}`;
    d.onclick = async () => { cfg = await api.setConfig({ theme: { name, ...th } }); applyTheme(); rerender(); toast('Theme: ' + name, 'ok'); };
    presets.appendChild(d);
  }
  p.appendChild(presets);
  p.appendChild(fieldRow('Background', '', color('theme.bg')));
  p.appendChild(fieldRow('Header', '', color('theme.headerBg')));
  p.appendChild(fieldRow('Text', '', color('theme.text')));
  p.appendChild(fieldRow('Accent', '', color('theme.accent')));
  p.appendChild(fieldRow('Grid lines', '', color('theme.grid')));
  p.appendChild(fieldRow('Window opacity', '', range('window.opacity', 0.3, 1, 0.02, 1)));
  p.appendChild(fieldRow('Font size (px)', '', number('fontSize', 9, 22, 1)));
  p.appendChild(fieldRow('Row height (px)', '', number('rowHeight', 16, 40, 1)));
  p.appendChild(header('Window', ''));
  p.appendChild(fieldRow('Always on top', '', toggle('alwaysOnTop')));
  p.appendChild(fieldRow('When to show the overlay', 'Auto: in lobbies and the Bedwars pre-game lobby (to scout players), hidden once the match starts and in other games like Duels. Manual: only when you press Alt+B. Always: always visible. Alt+B toggles it in every mode; notifications work in all of them.', select('overlayMode', [
    { v: 'auto', l: 'Auto (lobbies + pre-game)' }, { v: 'manual', l: 'Manual (Alt+B only)' }, { v: 'always', l: 'Always on' },
  ])));
  p.appendChild(fieldRow('F11 fullscreen fix', 'Some graphics drivers (e.g. NVIDIA) show Minecraft in F11 in a mode where nothing can appear on top. Solar makes the game window 1px taller so the overlay and popups stay visible. Looks the same; never takes focus.', toggle('fullscreenFix')));
  p.appendChild(fieldRow('Hide from screen capture', 'Invisible to OBS / Discord share / screenshots (Windows).', toggle('hideFromCapture')));
  p.appendChild(fieldRow('Click-through', 'Mouse passes through to the game. Toggle with Alt+X.', toggle('clickThrough')));

  p.appendChild(header('Row Highlight', 'Flag a whole row once a stat clears a threshold, so a nasty FKDR (or whatever you pick) jumps out without having to scan the column.'));
  p.appendChild(fieldRow('Enable highlight', '', toggle('highlightEnabled')));
  const custom = cfg.customColumns || [];
  const labelOf = (key) => COLLABELS[key] || (custom.find((c) => c.key === key) || {}).label || key;
  const statKeys = Object.keys(COLLABELS).filter((k) => k !== 'name' && k !== 'tag').concat(custom.map((c) => c.key));
  p.appendChild(fieldRow('Stat to watch', 'FKDR by default, but any column works.', select('highlightStat', statKeys.map((k) => ({ v: k, l: labelOf(k) })))));
  p.appendChild(fieldRow('Threshold', 'Row lights up once this stat is at or above the value.', number('highlightThreshold', 0, 1000000, 0.1)));
}

function panelColumns(p) {
  p.appendChild(header('Columns', 'Every column here is fully yours — add, remove, hide, and reorder any of them, built-in ones included.'));
  const cols = (cfg.columns || []).slice().sort((a, b) => a.order - b.order);
  const custom = cfg.customColumns || [];
  const labelOf = (key) => COLLABELS[key] || (custom.find((c) => c.key === key) || {}).label || key;
  const box = el('div');
  cols.forEach((c, idx) => {
    const r = el('div', 'colrow');
    const sw = toggle('__col_' + c.key); // visibility only — actual persistence happens below
    sw.querySelector('input').checked = c.visible;
    sw.querySelector('input').onchange = async (e) => { c.visible = e.target.checked; await set('columns', cols); };
    const nm = el('span', 'cname'); nm.textContent = labelOf(c.key);
    const up = el('button'); up.textContent = '▲'; const dn = el('button'); dn.textContent = '▼';
    up.onclick = async () => { if (idx > 0) { swap(cols, idx, idx - 1); cols.forEach((x, i) => x.order = i); await set('columns', cols); rerender(); } };
    dn.onclick = async () => { if (idx < cols.length - 1) { swap(cols, idx, idx + 1); cols.forEach((x, i) => x.order = i); await set('columns', cols); rerender(); } };
    const rm = el('button'); rm.textContent = '✕'; rm.title = 'Remove column';
    rm.onclick = async () => {
      cfg = await api.setConfig({
        columns: cols.filter((x) => x.key !== c.key),
        customColumns: custom.filter((x) => x.key !== c.key), // no-op for built-ins, drops the definition otherwise
      });
      rerender();
    };
    r.appendChild(sw); r.appendChild(nm); r.appendChild(up); r.appendChild(dn); r.appendChild(rm);
    box.appendChild(r);
  });
  p.appendChild(box);

  // Bring back a built-in column you removed earlier.
  const missingBuiltins = Object.keys(COLLABELS).filter((k) => !cols.some((c) => c.key === k));
  if (missingBuiltins.length) {
    const row = el('div'); row.style.cssText = 'display:flex;gap:8px;align-items:center;margin:6px 0 12px';
    const pick = el('select'); for (const k of missingBuiltins) { const o = el('option'); o.value = k; o.textContent = COLLABELS[k]; pick.appendChild(o); }
    const addBackBtn = el('button', 'ghost'); addBackBtn.textContent = '+ Add back';
    addBackBtn.onclick = async () => {
      cfg = await api.setConfig({ columns: [...cols, { key: pick.value, visible: true, order: cols.length }] });
      rerender();
    };
    row.appendChild(pick); row.appendChild(addBackBtn);
    p.appendChild(row);
  }

  const sortKeys = Object.keys(COLLABELS).concat(custom.map((c) => c.key));
  p.appendChild(fieldRow('Default sort column', '', select('sortBy', sortKeys.map((k) => ({ v: k, l: labelOf(k) })))));
  p.appendChild(fieldRow('Sort direction', '', select('sortDir', [{ v: 'desc', l: 'High → Low' }, { v: 'asc', l: 'Low → High' }])));

  p.appendChild(header('Custom columns', 'Pull a stat off your Hypixel player object, or off one of your Connections, by dot-path.'));
  const form = el('div'); form.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;align-items:center';
  const lbl = el('input'); lbl.type = 'text'; lbl.placeholder = 'Column label (e.g. Beds Broken)'; lbl.style.width = '180px';
  const srcSel = el('select'); for (const o of availableSources()) { const op = el('option'); op.value = o.v; op.textContent = o.l; srcSel.appendChild(op); }
  const pth = el('input'); pth.type = 'text'; pth.placeholder = 'stats.Bedwars.beds_broken_bedwars'; pth.style.width = '220px';
  const addBtn = el('button', 'act'); addBtn.textContent = 'Add column';
  addBtn.onclick = async () => {
    const label = lbl.value.trim(), path = pth.value.trim(), source = srcSel.value;
    if (!label || !path) { toast('Need both a label and a stat path', 'err'); return; }
    const key = 'custom:' + path.replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase() + '_' + Date.now().toString(36);
    const nextCustom = [...custom, { key, label, path, source }];
    const nextCols = [...cols, { key, visible: true, order: cols.length }];
    cfg = await api.setConfig({ customColumns: nextCustom, columns: nextCols });
    toast('Column added: ' + label, 'ok'); rerender();
  };
  form.appendChild(lbl); form.appendChild(srcSel); form.appendChild(pth); form.appendChild(addBtn);
  p.appendChild(form);
  const hint = el('div', 'kv');
  hint.textContent = 'Hypixel examples: stats.Bedwars.winstreak · stats.Bedwars.beds_broken_bedwars · networkExp · karma. For a Connection source, the path is relative to that connection\'s own JSON response.';
  p.appendChild(hint);

  catalogSection(p, custom);
  columnSourceSection(p, cols, custom, labelOf);
}

// Rewire an existing column (built-in or custom) to pull from a Connection instead of its
// normal source. Tag/BL just filter to that connection's tags; everything else needs a
// JSON path into that connection's response.
function columnSourceSection(p, cols, custom, labelOf) {
  p.appendChild(header('Column data sources', 'Map any column to one of your Connections — e.g. point Tag at just the Urchin endpoint, or pull M.FKDR/Winstreak from your own tracker instead of Hypixel.'));
  const mapped = cfg.columnSources || {};
  const allKeys = cols.map((c) => c.key);
  const mappedKeys = Object.keys(mapped).filter((k) => allKeys.includes(k));
  const connOpts = availableSources().filter((o) => o.v !== 'hypixel');

  const box = el('div');
  for (const key of mappedKeys) {
    const src = mapped[key] || {};
    const row = el('div', 'colrow');
    const nm = el('span', 'cname'); nm.textContent = labelOf(key);
    const srcSel = el('select');
    for (const o of connOpts) { const op = el('option'); op.value = o.v; op.textContent = o.l; if (src.source === o.v) op.selected = true; srcSel.appendChild(op); }
    srcSel.onchange = async () => {
      const next = { ...mapped, [key]: { ...mapped[key], source: srcSel.value } };
      cfg = await api.setConfig({ columnSources: next });
    };
    row.appendChild(nm); row.appendChild(srcSel);
    if (key !== 'tag' && key !== 'bl') {
      const pathInput = el('input'); pathInput.type = 'text'; pathInput.placeholder = 'json.path.in.response'; pathInput.style.width = '170px';
      pathInput.value = src.path || '';
      pathInput.onchange = async () => {
        const next = { ...mapped, [key]: { ...mapped[key], path: pathInput.value.trim() } };
        cfg = await api.setConfig({ columnSources: next });
      };
      row.appendChild(pathInput);
    }
    const rm = el('button'); rm.textContent = '✕'; rm.title = 'Remove mapping';
    rm.onclick = async () => { const next = { ...mapped }; delete next[key]; cfg = await api.setConfig({ columnSources: next }); rerender(); };
    row.appendChild(rm);
    box.appendChild(row);
  }
  p.appendChild(box);

  if (!connOpts.length) {
    const msg = el('div', 'kv'); msg.textContent = 'Add a Connection first (Connections tab) before mapping a column to it.';
    p.appendChild(msg);
    return;
  }
  const unmapped = allKeys.filter((k) => !mappedKeys.includes(k));
  if (!unmapped.length) return;

  const form = el('div'); form.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:6px';
  const colSel = el('select'); for (const k of unmapped) { const op = el('option'); op.value = k; op.textContent = labelOf(k); colSel.appendChild(op); }
  const connSel = el('select'); for (const o of connOpts) { const op = el('option'); op.value = o.v; op.textContent = o.l; connSel.appendChild(op); }
  const pathIn = el('input'); pathIn.type = 'text'; pathIn.placeholder = 'json.path (not needed for Tag/BL)'; pathIn.style.width = '200px';
  const addMapBtn = el('button', 'act'); addMapBtn.textContent = '+ Map column';
  addMapBtn.onclick = async () => {
    if (colSel.value !== 'tag' && colSel.value !== 'bl' && !pathIn.value.trim()) { toast('Need a JSON path for this column', 'err'); return; }
    const next = { ...mapped, [colSel.value]: { source: connSel.value, path: pathIn.value.trim() } };
    cfg = await api.setConfig({ columnSources: next });
    toast('Mapped ' + labelOf(colSel.value), 'ok'); rerender();
  };
  form.appendChild(colSel); form.appendChild(connSel); form.appendChild(pathIn); form.appendChild(addMapBtn);
  p.appendChild(form);
}

// Pre-built stat toggles, grouped by gamemode — flip one on/off and it's added to
// or pulled from customColumns + columns exactly like a hand-typed custom column.
function catalogSection(p, custom) {
  p.appendChild(header('More stats (by gamemode)', 'Off by default — turn on whatever you want to see. These read straight off the raw Hypixel player object, so a field only shows a value if Hypixel actually returns it for that account.'));
  for (const [game, items] of Object.entries(STAT_CATALOG)) {
    const gh = el('div'); gh.style.cssText = 'font-weight:600;margin:10px 0 2px;font-size:12px;color:var(--muted)'; gh.textContent = game;
    p.appendChild(gh);
    for (const item of items) {
      const active = custom.some((c) => c.key === item.key);
      const row = el('div', 'field');
      const l = el('div', 'l'); l.innerHTML = `<div class="name">${esc(item.label)}</div>`;
      const c = el('div', 'c');
      const sw = el('label', 'sw'); const i = el('input'); i.type = 'checkbox'; i.checked = active;
      const sl = el('span', 'slider'); sw.appendChild(i); sw.appendChild(sl);
      i.onchange = async () => {
        const nextCustom = (cfg.customColumns || []).slice();
        const nextCols = (cfg.columns || []).slice();
        if (i.checked) {
          if (!nextCustom.some((x) => x.key === item.key)) nextCustom.push({ key: item.key, label: item.label, path: item.path });
          if (!nextCols.some((x) => x.key === item.key)) nextCols.push({ key: item.key, visible: true, order: nextCols.length });
        } else {
          const ci = nextCustom.findIndex((x) => x.key === item.key); if (ci >= 0) nextCustom.splice(ci, 1);
          const oi = nextCols.findIndex((x) => x.key === item.key); if (oi >= 0) nextCols.splice(oi, 1);
        }
        cfg = await api.setConfig({ customColumns: nextCustom, columns: nextCols });
        rerender();
      };
      c.appendChild(sw); row.appendChild(l); row.appendChild(c);
      p.appendChild(row);
    }
  }
}
function swap(a, i, j) { const t = a[i]; a[i] = a[j]; a[j] = t; }

function panelSniper(p) {
  p.appendChild(header('Sniper / Threat Score', 'Your own 0–100 evaluation. Tune what feeds it. Higher weight = more influence.'));
  p.appendChild(el('div', 'sub')).textContent = 'CHILL < 20 · DECENT · SWEAT · TRYHARD · DANGER · SNIPER ≥ 85';
  const w = [
    ['sniperWeights.fkdr', 'FKDR (raw skill)'],
    ['sniperWeights.star', 'Bedwars star / level'],
    ['sniperWeights.wlr', 'Win/Loss ratio'],
    ['sniperWeights.winstreak', 'Current win streak'],
    ['sniperWeights.monthlyTrend', 'Recent sweat spike (monthly vs lifetime FKDR)'],
    ['sniperWeights.accountAge', 'Alt/sniper account signal (high star, low network level)'],
    ['sniperWeights.recentLogin', 'Logged in recently (actively playing)'],
    ['sniperWeights.tags', 'Blacklist / Urchin tags'],
    ['sniperWeights.freshAccount', 'Fresh account already performing well (classic smurf/alt signal)'],
  ];
  for (const [k, l] of w) p.appendChild(fieldRow(l, '', range(k, 0, 40, 1, 1)));
  const info = el('div', 'kv'); info.textContent = 'Weights are relative, not required to add up to 100 — the final score is capped there. Tags, account signals, and FKDR are weighted heaviest by default.';
  p.appendChild(info);
}

function panelPerf(p) {
  p.appendChild(header('Performance', 'Keep it lightweight. Fetches are cached and rate-limited for your key.'));
  p.appendChild(fieldRow('Auto-refresh (seconds)', '0 = only fetch when a new player is detected (lightest). Minimum 15 when on.', number('refreshSeconds', 0, 600, 5)));
  p.appendChild(fieldRow('Parallel lookups', 'How many players to fetch at once.', number('concurrency', 1, 10, 1)));
  p.appendChild(fieldRow('Stat cache (minutes)', 'Reuse fetched stats for this long.', number('cacheMinutes', 1, 30, 1)));

  p.appendChild(header('Rendering', 'How the overlay draws itself on top of your game.'));
  const gpu = toggle('gpuAcceleration');
  const restart = el('button', 'ghost'); restart.textContent = 'Restart now'; restart.style.marginLeft = '10px';
  restart.classList.add('hidden');
  restart.onclick = () => api.relaunch();
  const wrap = el('div'); wrap.style.cssText = 'display:flex;align-items:center';
  wrap.appendChild(gpu); wrap.appendChild(restart);
  // The setting only takes effect at launch - offer a restart whenever it differs from what's running.
  api.appInfo().then((info) => {
    const sync = () => restart.classList.toggle('hidden', !!cfg.gpuAcceleration === !!info.gpuAtLaunch);
    gpu.querySelector('input').addEventListener('change', () => setTimeout(sync, 50));
    sync();
  });
  p.appendChild(fieldRow('GPU acceleration', 'Off (recommended): the overlay renders on the CPU and never touches the GPU the game is using. This avoids Minecraft reporting "OpenGL error 1282 (invalid operation)" while the overlay is open. Needs a restart.', wrap));
}

function panelAbout(p) {
  p.appendChild(header('About', ''));
  const hero = el('div', 'about-hero standalone');
  hero.innerHTML = '<div class="mark"></div><div><div class="t1">Solar Overlay</div><div class="t2"></div></div>';
  hero.querySelector('.mark').innerHTML = SolarIcons.logo;
  api.appInfo().then((i) => { hero.querySelector('.t2').textContent = 'Version ' + i.version + ' · Hypixel Bed Wars overlay by vossis'; });
  p.appendChild(hero);

  // ---- updates ----
  p.appendChild(header('Updates', 'New versions come straight from GitHub. Each one is checked against Solar\'s release signature before it\'s installed, and nothing restarts by itself mid-game - it lands when you click Restart, or the next time you quit Solar.'));
  const box = el('div', 'upd');
  box.innerHTML = '<div class="ui"></div><div class="ut"><b></b><div></div><div class="progress hidden"><i></i></div></div><div class="ub"></div>';
  p.appendChild(box);
  const notes = el('div', 'notes hidden'); p.appendChild(notes);
  p.appendChild(fieldRow('Update automatically', 'Check on launch and every few hours, download in the background.', toggle('autoUpdate')));
  const btn = el('button', 'ghost'); box.querySelector('.ub').appendChild(btn);
  const paintUpd = (u) => {
    if (!box.isConnected || !u) return;
    const ui = box.querySelector('.ui'), t = box.querySelector('.ut b'), d = box.querySelector('.ut div'), bar = box.querySelector('.progress');
    ui.className = 'ui'; bar.classList.add('hidden'); btn.className = 'ghost'; btn.disabled = false; btn.classList.remove('hidden');
    notes.classList.add('hidden');
    const when = u.checkedAt ? 'Checked ' + ago(u.checkedAt) + '.' : '';
    switch (u.state) {
      case 'checking': ui.innerHTML = SolarIcons.sync; t.textContent = 'Checking for updates…'; d.textContent = ''; btn.classList.add('hidden'); break;
      case 'downloading':
        ui.innerHTML = SolarIcons.download; ui.classList.add('ready'); t.textContent = 'Downloading Solar ' + u.latest + '…'; d.textContent = 'Verified against the release signature before install.';
        bar.classList.remove('hidden'); bar.querySelector('i').style.width = Math.round((u.progress || 0) * 100) + '%'; btn.classList.add('hidden'); break;
      case 'ready':
        ui.innerHTML = SolarIcons.download; ui.classList.add('ready'); t.textContent = 'Solar ' + u.latest + ' is ready'; d.textContent = 'Restart now, or it installs the next time you quit.';
        btn.className = 'act'; btn.innerHTML = SolarIcons.sync + '<span>Restart to update</span>'; btn.onclick = () => api.installUpdate(); break;
      case 'available':
        ui.innerHTML = SolarIcons.download; ui.classList.add('ready'); t.textContent = 'Solar ' + u.latest + ' is available'; d.textContent = u.error || 'Get it from the releases page.';
        btn.innerHTML = '<span>Open releases</span>'; btn.onclick = () => api.openLink(u.url || 'https://github.com/realvossis/Solar-Bedwars-Overlay/releases'); break;
      case 'latest': ui.innerHTML = SolarIcons.check; ui.classList.add('ok'); t.textContent = 'You\'re up to date'; d.textContent = when; btn.innerHTML = '<span>Check again</span>'; btn.onclick = check; break;
      case 'error': ui.innerHTML = SolarIcons.alert; t.textContent = 'Couldn\'t update'; d.innerHTML = `<span class="bad">${esc(u.error)}</span>`; btn.innerHTML = '<span>Try again</span>'; btn.onclick = check; break;
      default: ui.innerHTML = SolarIcons.sync; t.textContent = 'Updates'; d.textContent = 'Not checked yet this session.'; btn.innerHTML = '<span>Check now</span>'; btn.onclick = check;
    }
    if (u.notes && (u.state === 'ready' || u.state === 'available' || u.state === 'downloading')) { notes.textContent = u.notes; notes.classList.remove('hidden'); }
  };
  async function check() { paintUpd({ state: 'checking' }); paintUpd(await api.checkForUpdate()); }
  api.getUpdateState().then(paintUpd);
  const offU = api.onUpdateState((u) => { if (box.isConnected) paintUpd(u); else offU(); });

  // ---- shortcuts ----
  p.appendChild(header('Shortcuts', 'Work everywhere, even with Minecraft focused.'));
  const keys = el('div', 'keys');
  for (const [k, what] of [['Alt+B', 'Show / hide the overlay'], ['Alt+X', 'Click-through'], ['Alt+C', 'Clear the list'], ['Alt+S', 'Settings'],
    ['Alt+N', 'Start / stop the nick roller'], ['Alt+T', 'Test notification in-game'], ['Alt+W', 'Type a chat warning (not sent)']]) {
    const a = el('span', 'pill'); a.textContent = k; const b = el('span'); b.textContent = what;
    keys.appendChild(a); keys.appendChild(b);
  }
  p.appendChild(keys);
  const tips = el('div', 'kv');
  tips.innerHTML = 'Right-click a column header to toggle columns, drag headers to reorder, click to sort. Right-click a player for Plancke, NameMC, tags and more. ' +
    'Party members are picked up automatically - no need to run /p list. Bundled local blacklist: <b>9,014 UUIDs / 9,349 tags</b>.';
  p.appendChild(tips);

  p.appendChild(header('Reset', ''));
  const reset = el('button', 'ghost'); reset.textContent = 'Reset all settings to defaults';
  reset.onclick = async () => { cfg = await api.resetConfig(); applyTheme(); rerender(); toast('Settings reset', 'ok'); };
  p.appendChild(fieldRow('Start fresh', 'Your API keys are cleared too.', reset));
}

function header(t, sub) { const d = el('div', 'sec-head'); d.innerHTML = `<h2>${esc(t)}</h2>` + (sub ? `<div class="sub">${esc(sub)}</div>` : ''); return d; }

// Turns a tab's flat list of headers + rows into a page title followed by one card per section:
// the first header is the page title, every later header opens a new card holding everything up
// to the next one. Keeps each panel function simple (they just append in order).
function groupSections(p) {
  let seenTitle = false, section = null;
  for (const k of [...p.children]) {
    if (k.classList.contains('sec-head')) {
      if (!seenTitle) { k.classList.add('page-head'); seenTitle = true; section = null; continue; }
      section = el('div', 'section'); p.insertBefore(section, k); section.appendChild(k); continue;
    }
    if (!seenTitle) continue;
    if (!section && (k.classList.contains('note') || k.classList.contains('standalone'))) continue; // banners stand on their own
    if (!section) { section = el('div', 'section'); p.insertBefore(section, k); }
    section.appendChild(k);
  }
}

// ---------- shell ----------
const TAB_ICONS = {
  General: 'user', 'Game Client': 'cube', Triggers: 'bolt', Notifications: 'bell', 'Name Watch': 'eye', 'Nick Roller': 'dice', 'Chat & Dodge': 'at', 'Discord Decoy': 'mask',
  'API Keys': 'key', Connections: 'link', Appearance: 'palette', Columns: 'columns', 'Sniper Score': 'target', Performance: 'gauge', About: 'info',
};
let active = 'General', lastActive = null, updateReady = false;
function buildTabs() {
  const nav = $('#tabs'); nav.innerHTML = '';
  for (const [group, names] of TAB_GROUPS) {
    nav.appendChild(el('div', 'tab-group')).textContent = group;
    for (const name of names) {
      const t = el('div', 'tab' + (name === active ? ' active' : ''));
      const ic = el('span', 'ic'); ic.innerHTML = SolarIcons[TAB_ICONS[name]] || '';
      const label = el('span'); label.textContent = name;
      t.appendChild(ic); t.appendChild(label);
      if (name === 'About' && updateReady) t.appendChild(el('span', 'badge')).textContent = 'Update';
      t.onclick = () => { active = name; rerender(); };
      nav.appendChild(t);
    }
  }
}
function rerender() {
  buildTabs();
  const p = $('#panel'); p.innerHTML = '';
  TABS[active](p);
  groupSections(p);
  // Only a new page slides in; re-renders of the same page (after a change) stay put.
  p.classList.toggle('enter', active !== lastActive);
  if (active !== lastActive) p.scrollTop = 0;
  lastActive = active;
}
for (const n of document.querySelectorAll('[data-icon]')) n.innerHTML = SolarIcons[n.dataset.icon] || '';
api.appInfo().then((i) => { $('#ver').textContent = 'v' + i.version; }).catch(() => {});

function toast(msg, kind) { const d = el('div', 'toast ' + (kind || '')); d.textContent = msg; $('#toasts').appendChild(d); setTimeout(() => d.remove(), 2500); }

$('#min').onclick = () => api.minimize();
$('#close').onclick = () => api.close();

(async () => {
  cfg = await api.getConfig(); applyTheme(); rerender();
  api.onConfigChanged((c) => { const themeChanged = JSON.stringify(c.theme) !== JSON.stringify(cfg.theme); cfg = c; if (themeChanged) applyTheme(); });
  const upd = (u) => { const r = !!u && u.state === 'ready'; if (r !== updateReady) { updateReady = r; buildTabs(); } };
  api.getUpdateState().then(upd); api.onUpdateState(upd);
})();
