'use strict';
// Nick styles: every listed example must match its own style, and the classic "obvious nick"
// shapes must be caught. Run: npm test
const assert = require('assert');
const { STYLES, stylesOf, tellsOf } = require('../src/main/nickStyles');
const { segment } = require('../src/main/nickWords');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ok  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' -> ' + e.message); } }
const ids = (n, enabled) => stylesOf(n, enabled).map((s) => s.id);

for (const s of STYLES) {
  t(`${s.name}: its own examples match`, () => {
    for (const ex of s.examples) assert.ok(ids(ex, [s.id]).length, `${ex} should be ${s.id}`);
  });
}
t('real nicks from the user\'s games land in the right styles', () => {
  assert.ok(ids('Eagleeee').includes('stretched'));
  assert.ok(ids('Fluffy_Kitty').includes('word_word'));
  assert.ok(ids('FluffyTea').includes('two_words'));
  assert.ok(ids('DeadlyKen').includes('two_words'));
  assert.ok(ids('BlueBlueBlue').includes('echo'));
});
t('random letters match none of the clean styles', () => {
  for (const n of ['v9gAKXHK', 'ecKlTH0W', 'HZR78yhd', 'qwzxplm', 'Xkqrtv_Bnmz', 'Brrrr']) {
    const clean = ids(n).filter((id) => ['og', 'stretched', 'echo', 'word_word', 'two_words', 'semi_og'].includes(id));
    assert.deepStrictEqual(clean, [], n + ' -> ' + clean);
  }
});
t('OG means a single real word, nothing added', () => {
  assert.ok(ids('Frost').includes('og'));
  for (const n of ['_Frost', 'xFrost', 'Frost1', 'Fr0st']) assert.ok(!ids(n).includes('og'), n);
});
t('semi-OG: plural / -ing / -y twists of real words', () => {
  for (const n of ['Ravens', 'Glitching', 'Frosty', 'Hunters', 'Running']) assert.ok(ids(n).includes('semi_og'), n);
  assert.ok(!ids('Raven').includes('semi_og')); // that's plain OG
});
t('the forum\'s "obvious nick" examples are all caught as tells', () => {
  for (const n of ['TheLegitPyro', 'im_esme265', 'itsviolet661', 'Rory417', 'teddycastro2006', 'theluckysn4ke', 'Gr3at3at766']) {
    assert.ok(tellsOf(n).length, n + ' should look like a nick');
  }
});
t('a rolled name that reads as a slur is always caught', () => {
  assert.ok(tellsOf('happyfangot').some((x) => x.id === 'offensive'));
  assert.deepStrictEqual(tellsOf('Cucumber').map((x) => x.id), []);
});
t('clean names show no tells', () => {
  for (const n of ['Eagleeee', 'Nice_Night', 'FluffyTea', 'Theo', 'Frost', 'Tony9', 'Jake2009']) assert.deepStrictEqual(tellsOf(n, ids(n)).map((x) => x.id), [], n);
});
t('a chosen NameYear / numbers style is not rejected for its own digits', () => {
  assert.deepStrictEqual(tellsOf('Rory417', ['name_num']).map((x) => x.id), []);
  assert.ok(tellsOf('Rory417', []).some((x) => x.id === 'many_digits'));
});
t('roller: chosen styles alone are enough to stop on a name', () => {
  const { buildRequirements } = require('../src/main/nickRoller');
  const req = buildRequirements({ styles: ['stretched', 'word_word'] });
  assert.strictEqual(req.empty, false);
  assert.ok(req.test('Eagleeee').ok);
  assert.ok(req.test('Nice_Night').ok);
  assert.strictEqual(req.test('FluffyTea').ok, false); // TwoWords not chosen
});
t('roller: rules OR styles, and obvious nicks skipped', () => {
  const { buildRequirements } = require('../src/main/nickRoller');
  const req = buildRequirements({ rules: ['cat'], styles: ['og'] });
  assert.ok(req.test('Frost').ok);
  assert.ok(req.test('Cats_Rule').ok);
  assert.strictEqual(req.test('TheCatKing').ok, false); // has "cat", but starts with "The"
  const loose = buildRequirements({ rules: ['cat'], styles: ['og'], avoidObvious: false });
  assert.ok(loose.test('TheCatKing').ok);
  assert.strictEqual(loose.test('happyfangot').ok, false); // offensive: never, even with the filter off
});
t('dictionary splitting', () => {
  assert.deepStrictEqual(segment('fluffykitty'), ['fluffy', 'kitty']);
  assert.deepStrictEqual(segment('deadlyken'), ['deadly', 'ken']);
  assert.strictEqual(segment('qwzxplm'), null);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
