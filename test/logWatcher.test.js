'use strict';
// Parser tests against real Hypixel message formats. Run: npm test
const assert = require('assert');
const { LogWatcher } = require('../src/main/logWatcher');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ok  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' -> ' + e.message); } }

// Feeds raw log lines through the parser and returns every event emitted, in order.
function run(lines, self = ['Me']) {
  const w = new LogWatcher();
  w.setSelfNames(self);
  const events = [];
  const orig = w.emit.bind(w);
  w.emit = (ev, ...args) => { events.push([ev, ...args]); return orig(ev, ...args); };
  for (const l of lines) w._parse('[12:00:00] [Client thread/INFO]: [CHAT] ' + l);
  return events;
}
const only = (events, name) => events.filter((e) => e[0] === name);

// ---- joining someone's party (the leader used to be dropped) ----
t('"You have joined X\'s party" names the leader', () => {
  const ev = run(["You have joined [MVP+] Leader_1's party!"]);
  assert.deepStrictEqual(only(ev, 'partyJoined'), [['partyJoined', 'Leader_1']]);
});
t('"You\'ll be partying with" lists everyone else', () => {
  const ev = run(["You'll be partying with: [VIP] Alpha, [MVP++] Beta, Gamma"]);
  assert.deepStrictEqual(only(ev, 'partyJoin'), [['partyJoin', ['Alpha', 'Beta', 'Gamma']]]);
});
t('member joining your party', () => {
  assert.deepStrictEqual(only(run(['[VIP+] Newbie joined the party.']), 'partyJoin'), [['partyJoin', ['Newbie']]]);
});

// ---- members picked up without /p list ----
t('party chat speaker is a party member', () => {
  assert.deepStrictEqual(only(run(['Party > [MVP+] Chatty: gg']), 'partyMember'), [['partyMember', 'Chatty']]);
});
t('party chat speaker is not also a lobby chatSpeaker', () => {
  assert.strictEqual(only(run(['Party > [MVP+] Chatty: gg']), 'chatSpeaker').length, 0);
});
t('your own party chat does not add you', () => {
  assert.strictEqual(only(run(['Party > [MVP+] Me: hi']), 'partyMember').length, 0);
});
t('summon identifies the leader', () => {
  assert.deepStrictEqual(only(run(['Party Leader, [MVP+] Boss, summoned you to their server.']), 'partyMember'), [['partyMember', 'Boss']]);
});
t('a member inviting someone else is in the party (the invitee is not yet)', () => {
  const ev = run(['[MVP+] Inviter invited [VIP] Guest to the party! They have 60 seconds to accept.']);
  assert.deepStrictEqual(only(ev, 'partyMember'), [['partyMember', 'Inviter']]);
});
t('promotion names both players', () => {
  const ev = run(['[MVP+] Boss has promoted [VIP] Helper to Party Moderator']);
  assert.deepStrictEqual(only(ev, 'partyMember').map((e) => e[1]), ['Boss', 'Helper']);
});
t('transfer because someone left', () => {
  const ev = run(['The party was transferred to [VIP] NewLead because [MVP+] OldLead left']);
  assert.deepStrictEqual(only(ev, 'partyMember'), [['partyMember', 'NewLead']]);
  assert.deepStrictEqual(only(ev, 'partyLeave'), [['partyLeave', 'OldLead']]);
});

// ---- /p list ----
const PLIST = [
  '-----------------------------------------------------',
  'Party Members (4)',
  'Party Leader: [MVP+] Boss ?',
  'Party Moderators: [VIP] Helper ?',
  'Party Members: [MVP++] Me ? Friend_2 ?',
  '-----------------------------------------------------',
];
t('/p list emits a complete, authoritative roster', () => {
  assert.deepStrictEqual(only(run(PLIST), 'partyRoster'), [['partyRoster', ['Boss', 'Helper', 'Me', 'Friend_2']]]);
});
t('/p list with UTF-8 bullet mojibake still parses', () => {
  const ev = run(['Party Members (2)', 'Party Leader: [MVP+] Boss â\u0097\u008f', 'Party Members: Pal â\u0097\u008f']);
  assert.deepStrictEqual(only(ev, 'partyRoster'), [['partyRoster', ['Boss', 'Pal']]]);
});
t('an incomplete /p list never becomes authoritative', () => {
  const ev = run(['Party Members (5)', 'Party Leader: [MVP+] Boss ?', 'Party Members: Pal ?', '-----------------------------------------------------']);
  assert.strictEqual(only(ev, 'partyRoster').length, 0);
  assert.strictEqual(only(ev, 'partyList').length, 2); // still additive
});

// ---- leaving / disbanding ----
t('member leaving', () => assert.deepStrictEqual(only(run(['[VIP] Quitter has left the party.']), 'partyLeave'), [['partyLeave', 'Quitter']]));
t('member kicked', () => assert.deepStrictEqual(only(run(['[VIP] Kicked1 has been removed from the party.']), 'partyLeave'), [['partyLeave', 'Kicked1']]));
t('kickoffline', () => assert.deepStrictEqual(only(run(['Kicked [VIP] Afk because they were offline.']), 'partyLeave'), [['partyLeave', 'Afk']]));
t('disconnect removal', () => assert.deepStrictEqual(only(run(['[MVP+] Lagger was removed from your party because they disconnected.']), 'partyLeave'), [['partyLeave', 'Lagger']]));
for (const line of ['You left the party.', 'You are not currently in a party.', '[MVP+] Boss has disbanded the party!',
  'The party was disbanded because all invites expired and the party was empty.', 'You have been kicked from the party by [MVP+] Boss']) {
  t('disband: ' + line, () => assert.strictEqual(only(run([line]), 'partyDisband').length, 1));
}

// ---- anti-spoofing: public chat can't fake system messages ----
t('public chat cannot fake a party join', () => {
  const ev = run(['[VIP] Troll: Victim joined the party.', 'Troll: You have joined [MVP+] Fake\'s party!']);
  assert.strictEqual(only(ev, 'partyJoin').length + only(ev, 'partyJoined').length, 0);
});
t('public chat cannot fake a party invite', () => {
  assert.strictEqual(only(run(['[VIP] Troll: Bob has invited you to join their party!']), 'partyInvite').length, 0);
});
t('real party invite still detected', () => {
  assert.deepStrictEqual(only(run(['[MVP+] Host has invited you to join their party!']), 'partyInvite'), [['partyInvite', 'Host']]);
});

// ---- final-kill "killed you" trigger is gone ----
t('final kills no longer emit killedYou', () => {
  const ev = run(['Me was killed by [MVP+] Other. FINAL KILL!', 'Someone was final killed by Other']);
  assert.strictEqual(only(ev, 'killedYou').length, 0);
});

// ---- mentions ----
t('mention on whole-word match', () => assert.strictEqual(only(run(['[VIP] Bob: gg me'], ['Me']), 'mention').length, 1));
t('no mention on substring match', () => assert.strictEqual(only(run(['[VIP] Bob: welcome home'], ['Me']), 'mention').length, 0));
// Exact raw shape from a real Lunar log (Latin-1 decoded, colour codes intact, names anonymised):
// Bedwars lobby chat puts the star level in guillemets before the rank.
const STAR_LINE = '§f«2§e18§68?»§r §b[MVP§1++§b] Friend_1§f: Me ?(^?^*)/';
t('mention with a «star» lobby prefix (was missed)', () => {
  assert.deepStrictEqual(only(run([STAR_LINE]), 'mention').map((e) => e[1].by), ['Friend_1']);
});
t('«star» prefix speakers count as chat speakers', () => {
  assert.deepStrictEqual(only(run(['«316?» [VIP] Someone: gl']), 'chatSpeaker'), [['chatSpeaker', 'Someone']]);
});
t('aliases typed with dots/spaces still work ("vossis. voss")', () => {
  assert.strictEqual(only(run(['[VIP] Bob: gg voss'], ['vossis. voss']), 'mention').length, 1);
});
t('match lifecycle lines (real Hypixel wording)', () => {
  const ev = run(['The game starts in 1 second!', '     Protect your bed and destroy the enemy beds.', 'You have been eliminated!']);
  assert.deepStrictEqual(ev.filter((e) => /^match/.test(e[0])).map((e) => e[0]), ['matchStarting', 'matchStart', 'matchEnd']);
});
t('server change carries game mode (game instance) vs none (lobby)', () => {
  const ev = only(run(['{"server":"mini86C","gametype":"DUELS","mode":"DUELS_SUMO_DUEL","map":"x"}', '{"server":"bedwarslobby5","gametype":"BEDWARS","lobbyname":"bedwarslobby5"}']), 'serverChange');
  assert.deepStrictEqual(ev.map((e) => [e[1].gametype, e[1].mode]), [['DUELS', 'DUELS_SUMO_DUEL'], ['BEDWARS', null]]);
});
t('chat cannot fake a match start', () => {
  assert.strictEqual(only(run(['[VIP] Troll: Protect your bed and destroy the enemy beds.']), 'matchStart').length, 0);
});
t('no mention for your own messages',() => assert.strictEqual(only(run(['[VIP] Me: me me'], ['Me']), 'mention').length, 0));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
