'use strict';
// OneClient support: UTF-8 logs, HyChatter/ChatTweaks restyled lines, location without /locraw.
// Line shapes are copied from a real OneClient 1.8.9 log (names anonymised). Run: npm test
const assert = require('assert');
const { LogWatcher, decodeLines } = require('../src/main/logWatcher');
const { Locator, describe } = require('../src/main/location');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ok  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' -> ' + e.message); } }

function run(lines, self = ['Me']) {
  const w = new LogWatcher();
  w.setSelfNames(self);
  const events = [];
  const orig = w.emit.bind(w);
  w.emit = (ev, ...args) => { events.push([ev, ...args]); return orig(ev, ...args); };
  w._feed(Buffer.from(lines.map((l) => (/^\[\d\d:\d\d:\d\d\]/.test(l) ? l : '[20:55:06] [Client thread/INFO]: [CHAT] ' + l) + '\n').join(''), 'utf8'));
  return events;
}
const only = (events, name) => events.filter((e) => e[0] === name);

// ---- encoding ----
t('a UTF-8 log is decoded as UTF-8 (OneClient)', () => {
  const st = { encoding: null };
  const { lines } = decodeLines(Buffer.from('[CHAT] §7[3✫]§r §7Name§f: hi\n', 'utf8'), st);
  assert.strictEqual(st.encoding, 'utf8');
  assert.ok(lines[0].includes('§7[3✫]'));
});
t('a Latin-1 log is decoded as Latin-1 (Lunar)', () => {
  const st = { encoding: null };
  const { lines } = decodeLines(Buffer.from([0x5b, 0xa7, 0x36, 0x5d, 0x20, 0x41, 0x0a]), st); // "[§6] A"
  assert.strictEqual(st.encoding, 'latin1');
  assert.strictEqual(lines[0], '[§6] A');
});
t('a multi-byte character split across reads is not mangled', () => {
  const w = new LogWatcher(); w.setSelfNames(['Me']);
  const got = [];
  w.on('chatSpeaker', (n) => got.push(n));
  const bytes = Buffer.from('[20:00:00] [Client thread/INFO]: [CHAT] §7[3✫]§r §7Abc_1§f: hi\n', 'utf8');
  const cut = bytes.indexOf(Buffer.from('✫', 'utf8')) + 1; // in the middle of ✫
  w._feed(bytes.subarray(0, cut)); w._feed(bytes.subarray(cut));
  assert.deepStrictEqual(got, ['Abc_1']);
  assert.strictEqual(w.decode.encoding, 'utf8');
});

// ---- HyChatter restyled game lines ----
t('"+ (2/2) Name" is a game join', () => {
  assert.deepStrictEqual(only(run(['+ (2/2) FluffyTea']), 'lobbyJoin'), [['lobbyJoin', 'FluffyTea', 'game']]);
});
t('padded count and compact-chat counter: "+ (01/16) Name (3)"', () => {
  assert.deepStrictEqual(only(run(['+ (01/16) Some_Guy (3)']), 'lobbyJoin'), [['lobbyJoin', 'Some_Guy', 'game']]);
});
t('"+ Name (3/16)" (count after the name) is a game join', () => {
  assert.deepStrictEqual(only(run(['+ Some_Guy (3/16)']), 'lobbyJoin'), [['lobbyJoin', 'Some_Guy', 'game']]);
});
t('Lunar-style "Name has joined (3/16)!" still works', () => {
  assert.deepStrictEqual(only(run(['Some_Guy has joined (3/16)!']), 'lobbyJoin'), [['lobbyJoin', 'Some_Guy', 'game']]);
});
t('"- (2/16) Name" is a quit', () => {
  assert.deepStrictEqual(only(run(['- (2/16) Leaver']), 'quit'), [['quit', 'Leaver']]);
});
t('chat starting with "+" is not a join', () => {
  const ev = run(['+ ilyPlacas: gg vro', '+25 Karma!', '+48 tokens! (Win)']);
  assert.strictEqual(only(ev, 'lobbyJoin').length, 0);
});
t('a mod list line in the log is not a quit', () => {
  assert.strictEqual(only(run(['[20:37:09] [main/INFO]: - argentum']), 'quit').length, 0);
});
t('"⁎ The game starts in 1 second! (2)" starts the match', () => {
  assert.strictEqual(only(run(['⁎ The game starts in 1 second! (2)']), 'matchStarting').length, 1);
});
t('Bed Wars start banner reports the game type', () => {
  assert.deepStrictEqual(only(run(['Protect your bed and destroy the enemy beds.']), 'matchStart'), [['matchStart', 'BEDWARS']]);
});

// ---- channels / DMs ----
t('short party channel "P > " is party chat', () => {
  const ev = run(['P > [MVP+] Chatty: gg']);
  assert.deepStrictEqual(only(ev, 'partyMember'), [['partyMember', 'Chatty']]);
  assert.strictEqual(only(ev, 'chatSpeaker').length, 0);
});
t('short guild channel "G > " is not a lobby speaker', () => {
  assert.strictEqual(only(run(['G > [MVP++] Guildie [TAG]: hi Me']), 'chatSpeaker').length, 0);
});
t('"PM < Name: hi" is a DM from them', () => {
  assert.deepStrictEqual(only(run(['PM < [MVP+] Sender: hey']), 'dmFrom'), [['dmFrom', 'Sender', 'hey']]);
});
t('"PM > Name: hi" is a DM to them', () => {
  assert.deepStrictEqual(only(run(['PM > [VIP] Target: yo']), 'dmTo'), [['dmTo', 'Target']]);
});

// ---- chat senders ----
t('titled lobby chat names the real sender', () => {
  const ev = run(['Parkour Grandmaster V [MVP+] Elu_tralix: hi Me']);
  assert.deepStrictEqual(only(ev, 'chatSpeaker'), [['chatSpeaker', 'Elu_tralix']]);
  assert.deepStrictEqual(only(ev, 'mention').map((e) => e[1].by), ['Elu_tralix']);
});
t('spectator chat with a title names the real sender', () => {
  assert.deepStrictEqual(only(run(['[SPECTATOR] Overlord [MVP+] Fluffy: gg']), 'chatSpeaker'), [['chatSpeaker', 'Fluffy']]);
});
t('"Opponent: [MVP+] X" is not someone talking', () => {
  assert.strictEqual(only(run(['Opponent: [MVP+] pixelkitty666']), 'chatSpeaker').length, 0);
});
t('"Winner: Me (2) ▏ Loser: X" is not a mention', () => {
  assert.strictEqual(only(run(['Winner: Me (2)  ▏  Loser: Someone']), 'mention').length, 0);
});
t('a mention keeps its text without the compact-chat counter', () => {
  assert.deepStrictEqual(only(run(['[VIP] Bob: hey Me (2)']), 'mention'), [['mention', { by: 'Bob', text: 'hey Me' }]]);
});

// ---- location signals ----
t('"Sending you to mini114BA!" names the server', () => {
  assert.deepStrictEqual(only(run(['Sending you to mini114BA!']), 'serverChange'), [['serverChange', { server: 'mini114BA', gametype: undefined, mode: undefined, map: undefined, via: 'chat' }]]);
});
t('"Sending you to mini5BG..." and a repeat "(2)" too', () => {
  const ev = only(run(['Sending you to mini5BG...', 'Sending you to mini5BG! (2)']), 'serverChange');
  assert.deepStrictEqual(ev.map((e) => e[1].server), ['mini5BG', 'mini5BG']);
});
t('your own lobby join says you are in a lobby', () => {
  const ev = run([' >>> [MVP++] Me joined the lobby! <<<', '[MVP+] Other joined the lobby!']);
  assert.deepStrictEqual(only(ev, 'lobbyEntered'), [['lobbyEntered', 'Me']]);
  assert.deepStrictEqual(only(ev, 'lobbyJoin'), [['lobbyJoin', 'Other', 'lobby']]);
});
t('seasonal lobby wording counts too', () => {
  assert.deepStrictEqual(only(run(['[MVP+] Me sled into the lobby!']), 'lobbyEntered'), [['lobbyEntered', 'Me']]);
});
t('the account comes from "Setting user:" - never from chat', () => {
  assert.deepStrictEqual(only(run(['[20:37:12] [Client thread/INFO]: Setting user: Real_Acc']), 'sessionUser'), [['sessionUser', 'Real_Acc']]);
  assert.strictEqual(only(run(['Setting user: Faker']), 'sessionUser').length, 0);
});

// ---- Locator ----
function locator() { let now = 1000; const l = new Locator(() => now); l.tick = (ms) => { now += ms; }; return l; }
t('chat switch to a game, then Lunar\'s blob for it = one change + enrichment', () => {
  const l = locator();
  assert.strictEqual(l.signal({ via: 'chat', server: 'mini28AN' }), 'change');
  assert.strictEqual(l.mode, 'UNKNOWN');
  l.tick(600);
  assert.strictEqual(l.signal({ via: 'locraw', server: 'mini28AN', gametype: 'BEDWARS', mode: 'BEDWARS_FOUR_FOUR', map: 'Crimson' }), 'enrich');
  assert.strictEqual(l.gametype, 'BEDWARS'); assert.strictEqual(l.mode, 'BEDWARS_FOUR_FOUR');
});
t('a lobby blob after your own lobby join line is enrichment, not a second clear', () => {
  const l = locator();
  l.signal({ via: 'locraw', server: 'mini1', gametype: 'BEDWARS', mode: 'BEDWARS_EIGHT_ONE' });
  l.tick(60000);
  assert.strictEqual(l.signal({ via: 'chat', lobby: true, self: true }), 'change');
  l.tick(500);
  assert.strictEqual(l.signal({ via: 'locraw', server: 'dynamiclobby9F', gametype: 'BEDWARS' }), 'enrich');
  assert.strictEqual(l.place.kind, 'lobby'); assert.strictEqual(l.server, 'dynamiclobby9F');
});
t('lobby join lines while already in a lobby are ignored', () => {
  const l = locator();
  l.signal({ via: 'chat', lobby: true, self: true });
  assert.strictEqual(l.signal({ via: 'chat', lobby: true }), 'ignore');
});
t('stragglers from the lobby you just left do not undo the switch', () => {
  const l = locator();
  l.signal({ via: 'chat', lobby: true, self: true });
  l.tick(20000);
  l.signal({ via: 'chat', server: 'mini9' });
  l.tick(800);
  assert.strictEqual(l.signal({ via: 'chat', lobby: true }), 'ignore');
  l.tick(30000);
  assert.strictEqual(l.signal({ via: 'chat', lobby: true }), 'change'); // much later: you really are back
});
t('status API fills in the game only for the matching kind of place', () => {
  const l = locator();
  l.signal({ via: 'chat', server: 'mini9' });
  assert.strictEqual(l.signal({ via: 'api', gametype: 'BEDWARS', mode: 'LOBBY' }), 'ignore'); // stale: still the lobby
  assert.strictEqual(l.signal({ via: 'api', gametype: 'DUELS', mode: 'DUELS_SUMO_DUEL' }), 'enrich');
  assert.strictEqual(l.gametype, 'DUELS');
});
t('a repeated "Sending you to X" is not a new switch', () => {
  const l = locator();
  l.signal({ via: 'chat', server: 'mini9' });
  l.tick(2000);
  assert.strictEqual(l.signal({ via: 'chat', server: 'mini9' }), 'ignore');
});
t('the Bed Wars banner settles an unknown game', () => {
  const l = locator();
  l.signal({ via: 'chat', server: 'mini9' });
  assert.strictEqual(l.gameStarted('BEDWARS'), true);
  assert.strictEqual(l.gametype, 'BEDWARS');
});
t('describe() reads well', () => {
  assert.strictEqual(describe({ kind: 'lobby', gametype: 'BEDWARS' }, false), 'Bed Wars lobby');
  assert.strictEqual(describe({ kind: 'game', gametype: 'BEDWARS', mode: 'X' }, false, { X: { name: 'Doubles' } }), 'Bed Wars Doubles · pre-game');
  assert.strictEqual(describe({ kind: 'game', gametype: null }, true), 'Game');
  assert.strictEqual(describe({ kind: 'unknown' }, false), null);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
