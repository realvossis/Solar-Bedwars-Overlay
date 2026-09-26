'use strict';
// Builds the chat warning about a flagged player - for party chat (sent automatically, if enabled)
// and for the public hotkey (typed into chat but never sent: you read it and press Enter yourself).
// Pure, so test/chatWarn.test.js can pin the formatting and length rules.

const CHAT_LIMIT = 100;                 // Minecraft 1.8 chat input limit, command prefix included
const PARTY_PREFIX = '/pc ';
const DEFAULTS = {
  party: '[Solar] {name}: {tag} - {reason}',
  public: 'Heads up: {name} is listed as {tag} - {reason}',
};

// Minecraft kicks you for "illegal characters in chat" (§, control characters, DEL). Tag text comes
// from Urchin/other lists - outside data - so it's always cleaned before it can reach the chat.
function clean(s) {
  return String(s == null ? '' : s)
    .replace(/§./g, '')
    .replace(/[\u0000-\u001f\u007f-\u009f§]/g, ' ')
    .replace(/[\u{10000}-\u{10ffff}]/gu, '') // astral-plane symbols (emoji) aren't typeable in 1.8 chat
    .replace(/\s+/g, ' ')
    .trim();
}

// "legit_sniper" -> "Legit Sniper"; keeps real categories like "Blatant Cheater" as they are.
function prettyType(type) {
  const t = clean(String(type || '').replace(/_/g, ' '));
  return t.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

// What to say about a player: the strongest tag's full category + its reason; a player who isn't
// listed anywhere but has a high sniper score is described by that instead.
function describe(row) {
  const u = (row && row.urchin) || {};
  const tags = (u.tags || []).slice().sort((a, b) => (b.severity || 0) - (a.severity || 0));
  const top = u.primary || tags[0];
  const s = row && row.stats, sn = row && row.sniper;
  if (top) {
    const reason = clean(top.reason && top.reason !== top.type ? top.reason : '');
    return { tag: prettyType(top.type || top.label || 'Flagged'), reason };
  }
  if (sn && sn.score) return { tag: `sniper score ${sn.score}`, reason: s ? `${(+s.fkdr).toFixed(1)} FKDR, ${s.star} stars` : '' };
  return { tag: 'flagged', reason: '' };
}

const cut = (s, n) => (n <= 3 ? '' : s.length <= n ? s : s.slice(0, n - 3).trimEnd() + '...');

// Fills the template and makes it fit: shorten the reason first, then drop it (with the separator
// in front of it), then shorten the tag. Never splits the player name.
function compose(template, row, { party = false } = {}) {
  const tpl = clean(template) || (party ? DEFAULTS.party : DEFAULTS.public);
  const name = clean(row && row.name).slice(0, 16);
  const { tag, reason } = describe(row);
  const budget = CHAT_LIMIT - (party ? PARTY_PREFIX.length : 0);
  const fill = (t, r, dropReason) => {
    let out = tpl;
    // Without a reason, remove the placeholder together with the separator right before it.
    if (dropReason || !r) out = out.replace(/\s*[-:–,(|]*\s*\{reason\}\)?/g, '');
    return out.replace(/\{name\}/g, name).replace(/\{tag\}/g, t).replace(/\{reason\}/g, r)
      .replace(/\{sniper\}/g, row && row.sniper ? String(row.sniper.score) : '?').replace(/\s+/g, ' ').trim();
  };
  let msg = fill(tag, reason, false);
  if (msg.length > budget && reason) {
    const over = msg.length - budget;
    const shorter = cut(reason, reason.length - over);
    msg = shorter.length >= 8 ? fill(tag, shorter, false) : fill(tag, '', true);
  }
  if (msg.length > budget) msg = fill(cut(tag, tag.length - (msg.length - budget)), '', true);
  if (msg.length > budget) msg = cut(msg, budget); // a very long custom template
  return (party ? PARTY_PREFIX : '') + msg;
}

// ---- auto-dodge ----
// Should this player make you leave the pre-game lobby? Returns a short human reason, or null.
// c = { onTagged, fkdrAbove, sniperAbove, onNicked } (0 = that check is off).
function dodgeReason(row, c = {}) {
  if (!row || row.source === 'SELF' || row.source === 'PARTY' || row.left) return null;
  if (row.nicked) return c.onNicked ? `${row.name} is nicked` : null;
  const u = row.urchin || {}, s = row.stats || {}, sn = row.sniper || {};
  if (c.onTagged && (u.severity || 0) >= 0.6) return `${row.name} is listed as ${describe(row).tag}`;
  if (+c.fkdrAbove > 0 && (+s.fkdr || 0) >= +c.fkdrAbove) return `${row.name} has ${(+s.fkdr).toFixed(2)} FKDR`;
  if (+c.sniperAbove > 0 && (+sn.score || 0) >= +c.sniperAbove) return `${row.name} has sniper score ${sn.score}`;
  return null;
}

// The leave command is typed and sent, so only a plain slash command is accepted - letters, digits,
// spaces, _ - . - nothing else. Anything else falls back to the safe default.
const DEFAULT_DODGE_COMMAND = '/l bedwars';
function safeCommand(cmd) {
  const c = String(cmd || '').trim();
  return /^\/[A-Za-z0-9_ .-]{1,60}$/.test(c) ? c : DEFAULT_DODGE_COMMAND;
}

module.exports = { compose, describe, clean, prettyType, dodgeReason, safeCommand, CHAT_LIMIT, DEFAULTS, DEFAULT_DODGE_COMMAND };
