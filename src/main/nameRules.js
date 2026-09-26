'use strict';
// Name Watch: the user's own list of name rules, checked against every player on the overlay.
// One rule per entry:
//   Cat            plain text - matches anywhere in the name, case-insensitive
//   /^x+_?$/i      a regular expression, written /body/flags
// Pure (no I/O), so test/nameRules.test.js can exercise it directly.

const MAX_RULES = 500;
const MAX_RULE_LENGTH = 200;
// No 'g'/'y': those make RegExp.test() stateful (lastIndex), so the same name could match on one
// check and not the next.
const ALLOWED_FLAGS = /^[imsu]*$/;

function parseRule(raw) {
  const source = String(raw == null ? '' : raw).trim();
  if (!source || source.startsWith('#')) return null; // blank lines and # comments are ignored
  if (source.length > MAX_RULE_LENGTH) return { source, error: `longer than ${MAX_RULE_LENGTH} characters` };
  const m = source.match(/^\/(.+)\/([a-z]*)$/);
  if (m) {
    if (!ALLOWED_FLAGS.test(m[2])) return { source, error: `unsupported flag(s) "${m[2]}" (use i, m, s, u)` };
    try { return { source, kind: 'regex', re: new RegExp(m[1], m[2]) }; }
    catch (e) { return { source, error: 'invalid regex: ' + e.message }; }
  }
  return { source, kind: 'text', needle: source.toLowerCase() };
}

// -> { rules: [...valid], errors: [{ source, error }] }
function compile(list) {
  const rules = [], errors = [];
  for (const raw of (Array.isArray(list) ? list : []).slice(0, MAX_RULES)) {
    const r = parseRule(raw);
    if (!r) continue;
    if (r.error) errors.push({ source: r.source, error: r.error }); else rules.push(r);
  }
  return { rules, errors };
}

// Returns the source text of every rule the name matches (empty array = no match). Names are
// at most 16 characters, which also bounds how much work any user-written regex can do here.
function match(compiled, name) {
  const n = String(name || '').slice(0, 32);
  if (!n || !compiled) return [];
  const lower = n.toLowerCase();
  const hits = [];
  for (const r of compiled.rules) {
    if (r.kind === 'text' ? lower.includes(r.needle) : r.re.test(n)) hits.push(r.source);
  }
  return hits;
}

module.exports = { parseRule, compile, match, MAX_RULES, MAX_RULE_LENGTH };
