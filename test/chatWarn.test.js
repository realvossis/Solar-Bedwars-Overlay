'use strict';
// Chat warning formatting: full tag text, length limit, truncation, sanitizing. Run: npm test
const assert = require('assert');
const { compose, describe, clean, CHAT_LIMIT } = require('../src/main/chatWarn');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ok  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' -> ' + e.message); } }

const tagged = (type, reason, extra = {}) => ({ name: 'Sheplock', urchin: { tags: [{ type, reason, severity: 1 }], primary: { type, reason, severity: 1 } }, ...extra });

t('uses the full tag category and reason', () => {
  assert.strictEqual(compose('', tagged('Blatant Cheater', 'blatant legitscaff, ka')), 'Heads up: Sheplock is listed as Blatant Cheater - blatant legitscaff, ka');
});
t('party messages get /pc and still fit', () => {
  const m = compose('', tagged('Confirmed Cheater', 'x'.repeat(300)), { party: true });
  assert.ok(m.startsWith('/pc [Solar] Sheplock: Confirmed Cheater - '), m);
  assert.ok(m.length <= CHAT_LIMIT, 'length ' + m.length); assert.ok(m.endsWith('...'));
});
t('public messages never exceed the chat limit', () => {
  for (const len of [0, 10, 60, 90, 150, 1000]) {
    const m = compose('', tagged('Closet Cheater', 'r'.repeat(len)));
    assert.ok(m.length <= CHAT_LIMIT, len + ' -> ' + m.length);
  }
});
t('very short remaining room drops the reason cleanly (no dangling separator)', () => {
  const m = compose('{name} ::: {tag} - {reason}', tagged('A'.repeat(88), 'some long reason'));
  assert.ok(!/ - $|- \.\.\.$/.test(m), m); assert.ok(m.length <= CHAT_LIMIT);
});
t('overlong tag is shortened with ...', () => {
  const m = compose('', tagged('Y'.repeat(200), ''));
  assert.ok(m.length <= CHAT_LIMIT && m.endsWith('...'), m);
});
t('no reason: separator is removed with the placeholder', () => {
  assert.strictEqual(compose('', tagged('Sniper', '')), 'Heads up: Sheplock is listed as Sniper');
});
t('bundled type names are prettified', () => {
  assert.strictEqual(describe(tagged('legit_sniper', 'snipes')).tag, 'Legit Sniper');
});
t('not listed but high sniper score: says so', () => {
  const m = compose('', { name: 'Recoverin', urchin: { tags: [] }, sniper: { score: 88 }, stats: { fkdr: 9.46, star: 612 } });
  assert.strictEqual(m, 'Heads up: Recoverin is listed as sniper score 88 - 9.5 FKDR, 612 stars');
});
t('custom templates and {sniper}', () => {
  assert.strictEqual(compose('careful, {name} ({tag}) sniper {sniper}', tagged('Caution', 'x', { sniper: { score: 71 } })), 'careful, Sheplock (Caution) sniper 71');
});
t('illegal chat characters from list data are removed (would get you kicked)', () => {
  const m = compose('', tagged('Blatant§c Cheater', 'reach\u0000 §kxx \u{1F600} fly'));
  assert.ok(!/[\u0000-\u001f§]/.test(m) && !/\u{1F600}/u.test(m), JSON.stringify(m));
  assert.ok(m.includes('Blatant Cheater'));
});
t('clean() collapses whitespace', () => { assert.strictEqual(clean('  a \n\t b  '), 'a b'); });
t('custom template cannot smuggle a command prefix into party messages', () => {
  assert.ok(compose('{name}', tagged('X', '')).indexOf('/pc') === -1);
  assert.ok(compose('/kill {name}', tagged('X', ''), { party: true }).startsWith('/pc /kill'), 'party prefix always first');
});

// ---- auto-dodge ----
const { dodgeReason, safeCommand } = require('../src/main/chatWarn');
const player = (o) => ({ name: 'P', source: 'GAME', urchin: { tags: [], severity: 0 }, stats: { fkdr: 2 }, sniper: { score: 20 }, ...o });
t('dodge: tagged player (when enabled)', () => {
  assert.match(dodgeReason(tagged('Blatant Cheater', 'x', { source: 'GAME', urchin: { severity: 1, tags: [{ type: 'Blatant Cheater', reason: 'x', severity: 1 }] } }), { onTagged: true }), /listed as Blatant Cheater/);
  assert.strictEqual(dodgeReason(player({ urchin: { severity: 1, tags: [] } }), { onTagged: false }), null);
});
t('dodge: FKDR and sniper thresholds (0 = off)', () => {
  assert.match(dodgeReason(player({ stats: { fkdr: 12.3 } }), { fkdrAbove: 10 }), /12\.30 FKDR/);
  assert.strictEqual(dodgeReason(player({ stats: { fkdr: 12.3 } }), { fkdrAbove: 0 }), null);
  assert.match(dodgeReason(player({ sniper: { score: 91 } }), { sniperAbove: 85 }), /sniper score 91/);
});
t('dodge: nicked only if chosen; never for you or your party', () => {
  assert.strictEqual(dodgeReason(player({ nicked: true }), { onTagged: true }), null);
  assert.match(dodgeReason(player({ nicked: true }), { onNicked: true }), /nicked/);
  assert.strictEqual(dodgeReason(player({ source: 'PARTY', stats: { fkdr: 50 } }), { fkdrAbove: 5 }), null);
  assert.strictEqual(dodgeReason(player({ source: 'SELF', stats: { fkdr: 50 } }), { fkdrAbove: 5 }), null);
});
t('dodge command: only plain slash commands, else the safe default', () => {
  assert.strictEqual(safeCommand('/play bedwars_eight_one'), '/play bedwars_eight_one');
  for (const bad of ['hello everyone', '/l bedwars\n/p disband', '/msg x §c', '', '/'.padEnd(80, 'a')]) assert.strictEqual(safeCommand(bad), '/l bedwars', JSON.stringify(bad));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
