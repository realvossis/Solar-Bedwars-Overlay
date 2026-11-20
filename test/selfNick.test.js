'use strict';
// Own-nick detection from arrival join bursts (see selfNick.js). Run: npm test
const assert = require('assert');
const { SelfNick } = require('../src/main/selfNick');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ok  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' -> ' + e.message); } }

function setup(real = 'Me_Real') {
  let now = 0;
  const d = new SelfNick(() => now);
  const known = new Set([real.toLowerCase()]);
  const isMe = (n) => known.has(String(n).toLowerCase()) || (d.nick && d.nick.toLowerCase() === String(n).toLowerCase());
  const game = (names, party = new Set(), lateNames = []) => {
    d.arrived();
    for (const n of names) d.joined(n);
    now += 3000; for (const n of lateNames) d.joined(n); // joins after the window don't count
    const r = d.judge(isMe, party);
    now += 60000;
    return r;
  };
  return { d, game };
}

t('your nick is learned after two solo arrivals', () => {
  const { d, game } = setup();
  assert.strictEqual(game(['DeadlyKen']), null);
  assert.strictEqual(game(['DeadlyKen'], new Set(), ['Opponent1']), 'DeadlyKen');
  assert.strictEqual(d.nick, 'DeadlyKen');
});
t('scrambled names never repeat, so they are never learned', () => {
  const { d, game } = setup();
  game(['v9gAKXHK']); game(['ecKlTH0W']); game(['HZR78yhd']);
  assert.strictEqual(d.nick, null);
});
t('a nicked teammate arriving with you is never taken for you', () => {
  const { d, game } = setup();
  for (let i = 0; i < 5; i++) assert.strictEqual(game(['MyNick', 'MateNick']), null);
  assert.strictEqual(d.nick, null);
});
t('once your nick is known, a teammate in the same burst is not learned instead', () => {
  const { d, game } = setup();
  game(['MyNick']); game(['MyNick']);
  assert.strictEqual(d.nick, 'MyNick');
  for (let i = 0; i < 5; i++) game(['MyNick', 'MateNick']);
  assert.strictEqual(d.nick, 'MyNick');
});
t('your real name arriving (not nicked) teaches nothing', () => {
  const { d, game } = setup();
  for (let i = 0; i < 3; i++) game(['Me_Real', 'PartyPal']);
  assert.strictEqual(d.nick, null);
});
t('known party members are left out of the burst', () => {
  const { d, game } = setup();
  const party = new Set(['pal1', 'pal2']);
  game(['Pal1', 'Pal2', 'MyNick'], party); game(['MyNick', 'Pal1'], party);
  assert.strictEqual(d.nick, 'MyNick');
});
t('a new nick replaces the old one after two games', () => {
  const { d, game } = setup();
  game(['OldNick']); game(['OldNick']);
  game(['FreshNick']);
  assert.strictEqual(d.nick, 'OldNick');
  assert.strictEqual(game(['FreshNick']), 'FreshNick');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
