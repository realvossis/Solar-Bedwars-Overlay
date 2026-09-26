'use strict';
// Name Watch rule parsing/matching tests. Run: npm test
const assert = require('assert');
const { compile, match, MAX_RULES } = require('../src/main/nameRules');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ok  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' -> ' + e.message); } }

t('plain text matches anywhere, case-insensitive', () => {
  const c = compile(['Cat']);
  assert.deepStrictEqual(match(c, 'xXcatlover'), ['Cat']);
  assert.deepStrictEqual(match(c, 'Dogman'), []);
});
t('regex rules', () => {
  const c = compile(['/^[a-z]{3,4}$/i', '/_{2}/']);
  assert.deepStrictEqual(match(c, 'Wolf'), ['/^[a-z]{3,4}$/i']);
  assert.deepStrictEqual(match(c, 'a__b'), ['/_{2}/']);
  assert.deepStrictEqual(match(c, 'Wolves'), []);
});
t('multiple rules report every hit', () => {
  assert.deepStrictEqual(match(compile(['cat', '/^C/']), 'Catnip'), ['cat', '/^C/']);
});
t('blank lines and # comments are skipped', () => {
  const c = compile(['', '   ', '# my list', 'owl']);
  assert.strictEqual(c.rules.length, 1); assert.strictEqual(c.errors.length, 0);
});
t('invalid regex is reported, not thrown', () => {
  const c = compile(['/([a-z/']);
  assert.strictEqual(c.rules.length, 0); assert.match(c.errors[0].error, /invalid regex/);
});
t('stateful g/y flags are rejected', () => {
  const c = compile(['/cat/g']);
  assert.strictEqual(c.rules.length, 0); assert.match(c.errors[0].error, /unsupported flag/);
});
t('matching is stable across repeated checks', () => {
  const c = compile(['/cat/i']);
  for (let i = 0; i < 5; i++) assert.deepStrictEqual(match(c, 'Cat'), ['/cat/i']);
});
t('overlong rules are rejected and rule count is capped', () => {
  assert.strictEqual(compile(['x'.repeat(201)]).errors.length, 1);
  assert.strictEqual(compile(Array.from({ length: MAX_RULES + 50 }, (_, i) => 'n' + i)).rules.length, MAX_RULES);
});
t('regex metacharacters in plain text are literal', () => {
  assert.deepStrictEqual(match(compile(['a.b']), 'axb'), []);
  assert.deepStrictEqual(match(compile(['a.b']), 'xa.bx'), ['a.b']);
});
t('garbage input is safe', () => {
  assert.deepStrictEqual(match(compile(null), 'x'), []);
  assert.deepStrictEqual(match(compile(['cat']), ''), []);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
