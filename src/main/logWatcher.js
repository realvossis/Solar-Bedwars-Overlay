'use strict';
// Tails whatever Minecraft log file the user points us at — Lunar, vanilla, Badlion,
// doesn't matter which — and turns the chat noise into the normalized events below.
// Also copes with the log getting rotated or truncated out from under us mid-read.
//
// What it emits:
//   who(names[])        - /who or accumulated pre-game lobby
//   lobbyJoin(name)     - "X has joined (n/m)!" or the real Bedwars "X joined the lobby!"
//   chatSpeaker(name)   - whoever just said anything in normal chat - a catch-all presence signal
//                         independent of the exact join-message wording above
//   quit(name)          - "X has quit!"
//   partyJoin(names[])  - joined your party / "You'll be partying with: ..."
//   partyJoined(leader) - YOU joined someone else's party ("You have joined X's party!")
//   partyMember(name)   - someone proven to be in your party right now: party chat, a summon, a
//                         promotion/transfer, inviting someone else - so members get picked up
//                         without anyone having to run /p list
//   partyList(names[])  - one "Party Leader/Moderators/Members:" line of /p list
//   partyRoster(names[])- the complete /p list, once every member it announced has been parsed -
//                         authoritative, so anyone not in it is no longer in the party
//   partyLeave(name)    - someone left / was kicked / was removed from your party
//   partyDisband()      - you left, got kicked, the party was disbanded, or you're not in one
//   partyInvite(name)   - invited you
//   friendRequest(name) - friend request
//   dmFrom(name), dmTo(name)
//   mention({by,text})  - your name said in chat
//   finalKillCount({killer,victim,count}) - a kill line carrying the killer's lifetime final-kill
//                         tally (e.g. "Victim was Killer's #3560 FINAL KILL!") — the only lead we
//                         get on a nicked killer's real identity, see hypixel.findByFinalKills()
//   houseEntered(name)  - teleporting into someone's Housing instance
//   serverChange()      - sent to a new server / game over
const fs = require('fs');
const { EventEmitter } = require('events');

const NAME = '[A-Za-z0-9_]{1,16}';
const stripColors = (s) => s.replace(/§[0-9a-fk-or]/gi, '').replace(/§[0-9a-fk-or]/gi, '');
const stripRank = (s) => s.trim().replace(/^(?:\[[^\]]+\]\s*)+/, '').replace(/[^A-Za-z0-9_].*$/, '').trim();
// Guild/Party/Officer chat lines put a "Guild > " style channel tag before the
// rank+name, e.g. "Guild > [VIP] Name: text" — strip it before matching the
// sender so mentions in those channels aren't missed (public chat has no tag).
const CHANNEL_PREFIX = /^(?:Guild|Party|Officer|Co-op|Alliance)\s*>\s*/i;

function chatOf(line) {
  const clean = stripColors(line);
  let i = clean.indexOf('[CHAT]');
  if (i >= 0) return clean.slice(i + 6).trim();
  i = clean.indexOf(']: ');
  if (i >= 0) return clean.slice(i + 3).trim();
  return clean.trim();
}
function validName(n) { return /^[A-Za-z0-9_]{1,16}$/.test(n); }
// Zero or more "[RANK] " prefixes in front of a name.
const RANKS = '(?:\\[[^\\]]+\\]\\s*)*';
// Chat-only prefixes in front of the rank: besides "[316✫]"-style brackets, Bedwars lobbies show the
// star level in guillemets, e.g. "«2188❁» [MVP++] Name: hi" (the symbol arrives as "?" after the
// log's Latin-1 decoding). Missing this format is what made mentions from those players vanish.
const CHAT_PREFIX = '(?:(?:\\[[^\\]]+\\]|«[^»]{0,24}»)\\s*)*';
// Every party/social pattern below is anchored at the start of the message. Player chat always
// starts with the sender's own "[RANK] Name: ", so anchoring is what stops someone from typing
// "Bob joined the party" in public chat and getting Bob treated as your party member.
const rx = (body) => new RegExp('^' + body);
const P = {
  youJoined: rx('You have joined ' + RANKS + '(' + NAME + ")'s party"),
  memberJoined: rx(RANKS + '(' + NAME + ') (?:has )?joined the party'),
  partyingWith: /^You'll be partying with:\s*(.+)$/,
  rosterHeader: /^Party Members \((\d+)\)/,
  rosterLine: /^Party (?:Members|Leader|Moderators):/,
  summoned: rx('Party Leader,? ' + RANKS + '(' + NAME + '),? summoned you'),
  promoted: rx(RANKS + '(' + NAME + ') has promoted ' + RANKS + '(' + NAME + ') to Party'),
  transferredLeft: rx('The party was transferred to ' + RANKS + '(' + NAME + ') because ' + RANKS + '(' + NAME + ') left'),
  transferredBy: rx('The party was transferred to ' + RANKS + '(' + NAME + ') by ' + RANKS + '(' + NAME + ')'),
  invitedOther: rx(RANKS + '(' + NAME + ') invited ' + RANKS + '(' + NAME + ') to the party'),
  left: rx(RANKS + '(' + NAME + ') has left the party'),
  removed: rx(RANKS + '(' + NAME + ') has been removed from the party'),
  kickedOffline: rx('Kicked ' + RANKS + '(' + NAME + ') because they were offline'),
  disconnected: rx(RANKS + '(' + NAME + ') was removed from your party because they disconnected'),
  disband: /^(?:You left the party|You are not (?:currently )?in a party|The party was disbanded|You have been kicked from the party)/,
  disbandedBy: rx(RANKS + NAME + ' has disbanded the party'),
  invitedYou: rx(RANKS + '(' + NAME + ') has invited you to join'),
  friendReq1: rx(RANKS + '(' + NAME + ') has sent you a friend request'),
  friendReq2: rx('Friend request from ' + RANKS + '(' + NAME + ')'),
};
// Hypixel frames multi-line replies (like /p list) with a long run of dashes.
const SEPARATOR = /^[-=▬]{8,}$/;
// Splits one "Party Members: [MVP+] A ● [VIP] B ●" line into names. The ● bullet never survives
// the log's Latin-1 decoding intact (it arrives as "?" or mojibake), so whitespace is what really
// separates entries here - rank tags and bullet debris just fail validName and drop out.
const namesFrom = (list) => list.split(/[\s,●]+/).map(stripRank).filter(validName);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

class LogWatcher extends EventEmitter {
  constructor() {
    super();
    this.path = null;
    this.pos = 0;
    this.ino = 0;
    this.watcher = null;
    this.timer = null;
    this.buffer = '';
    this.selfNames = [];
    this._selfRe = null;
    this._ok = false;
    this._roster = null; // in-progress /p list: { expected, names }
  }

  setSelfNames(names) {
    // Split on anything that can't be part of a name, so "vossis. voss" or "a; b" still yields both.
    this.selfNames = (names || []).flatMap((n) => String(n || '').split(/[^A-Za-z0-9_]+/)).map((n) => n.toLowerCase()).filter(validName);
    // Whole-word match, so an IGN like "Ace" isn't "mentioned" by every "race"/"face" in chat.
    this._selfRe = this.selfNames.length ? new RegExp('(?:^|[^a-z0-9_])(?:' + this.selfNames.map(escapeRe).join('|') + ')(?![a-z0-9_])', 'i') : null;
  }

  start(logPath) {
    this.stop();
    this.path = logPath;
    if (!logPath) { this.emit('status', { ok: false, msg: 'no log path set' }); return; }
    let st = null;
    try { st = fs.statSync(logPath); } catch (_) {}
    this.pos = st ? st.size : 0;
    this.ino = st ? st.ino : 0;
    this._ok = !!st;
    // Poll (fs.watch is unreliable across clients/OSes). 400ms is plenty and cheap. The timer
    // starts either way - if the file doesn't exist yet (overlay launched before the game), the
    // poll below just keeps checking until it appears instead of giving up for good.
    this.timer = setInterval(() => this._poll(), 400);
    this.emit('status', { ok: this._ok, msg: this._ok ? ('watching ' + logPath) : 'log not found yet - waiting for it to appear' });
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null; this.buffer = ''; this._roster = null;
  }

  _poll() {
    let st;
    try { st = fs.statSync(this.path); } catch (_) { return; } // not there yet (or again) - keep waiting
    // The file didn't exist a moment ago and just appeared (first-ever launch, or the overlay
    // started before the game created it) - read it from byte 0, since there's no stale prior
    // session in it to skip past, unlike the already-existed-at-start() case below.
    if (!this._ok) { this._ok = true; this.pos = 0; this.ino = st.ino; this.emit('status', { ok: true, msg: 'watching ' + this.path }); return; }
    // A real Minecraft (re)launch rolls latest.log over to a brand new file - its file-index
    // number (ino) changing is the reliable signal for that. birthtime looks like it should work
    // too but doesn't: Windows/NTFS "tunneling" preserves the old creation time (and short name)
    // for a file recreated at the same path shortly after the old one is removed, even across a
    // rename-away-then-recreate rollover - verified empirically, it never changes here. ino does.
    // Relying only on "size got smaller" (below) misses rotation whenever the new session's
    // startup logging outgrows our old, stale `pos` before the next 400ms poll, which otherwise
    // leaves us reading from a garbage mid-file offset in a different game session entirely -
    // silently skipping the early who/party lines that seed the roster.
    if (this.ino && st.ino && st.ino !== this.ino) this.pos = 0;
    this.ino = st.ino;
    if (st.size < this.pos) this.pos = 0; // truncated in place (belt-and-suspenders, e.g. same ino somehow)
    if (st.size === this.pos) return;
    const stream = fs.createReadStream(this.path, { start: this.pos, end: st.size });
    let chunk = '';
    // Minecraft/Lunar write logs in the JVM's platform charset (Latin-1 on Windows), not UTF-8 —
    // decoding as utf8 turns every §-color-code byte into a replacement char and silently breaks
    // all rank/name parsing in colored chat lines (which is most real chat).
    stream.on('data', (d) => { chunk += d.toString('latin1'); });
    stream.on('end', () => {
      this.pos = st.size;
      this.buffer += chunk;
      const lines = this.buffer.split(/\r?\n/);
      this.buffer = lines.pop(); // keep partial last line
      for (const l of lines) this._parse(l);
    });
    stream.on('error', () => {});
  }

  _parse(rawLine) {
    if (!rawLine) return;
    const msg = chatOf(rawLine);
    if (!msg) return;
    // chatOf()'s fallback (no explicit [CHAT] tag) is deliberately permissive so lobby/party/who
    // system lines that don't always carry the tag still get through - but that same tolerance
    // means plain, unrelated "Label: value" log lines (e.g. OptiFine's startup dump - "Capabilities:
    // ...", "OpenGL: ...", "Renderer: ...", "Build: ...") pass through chatOf() unchanged too, since
    // they have no "]: " or "[CHAT]" of their own to strip. Real chat is only trustworthy as chat
    // when the line was actually tagged - restrict the "someone said something" detection below
    // (chatSpeaker/mention) to that, without narrowing chatOf() itself for everything else.
    const isChatLine = /\[CHAT\]/.test(stripColors(rawLine));

    // ---- /who or auto-who: "ONLINE: a, b, c" ----
    let m = msg.match(/^ONLINE:\s*(.+)$/);
    if (m) {
      const names = m[1].split(',').map((s) => stripRank(s)).filter(validName);
      if (names.length) this.emit('who', names);
      return;
    }

    // ---- pre-game lobby fill: "Name has joined (1/16)!" (seen on some other lobby types) ----
    m = msg.match(new RegExp('^(?:\\[[^\\]]+\\]\\s*)*(' + NAME + ') has joined \\(\\d+\\/\\d+\\)!'));
    if (m) { this.emit('lobbyJoin', m[1]); return; }

    // ---- Bedwars pre-game lobby fill, real captured format: ">>> [rank] Name joined the lobby! <<<"
    // for boosted/high-rank players, or just "[rank] Name joined the lobby!" (no arrows) for everyone
    // else - NOT the "(n/m)" form above, which never actually appears here. Verified against a real
    // captured log; this was the actual reason join detection silently caught nobody in the pre-game
    // lobby before. ----
    m = msg.match(new RegExp('^(?:>>>\\s*)?(?:\\[[^\\]]+\\]\\s*)*(' + NAME + ')\\s+joined the lobby!'));
    if (m) { this.emit('lobbyJoin', m[1]); return; }

    // ---- quit: "Name has quit!" ----
    m = msg.match(new RegExp('^(?:\\[[^\\]]+\\]\\s*)*(' + NAME + ') has quit!'));
    if (m) { this.emit('quit', m[1]); return; }

    // ---- Housing: "Attempting to teleport you to [Rank] Name's house..." — the only real
    // clue to who the house belongs to, since Housing has no lobby-fill/kill-feed messages
    // the way Bedwars does. Verified against a real captured log line. ----
    m = msg.match(new RegExp('^Attempting to teleport you to (?:\\[[^\\]]+\\]\\s*)*(' + NAME + ')\'s house'));
    if (m) { this.emit('houseEntered', m[1]); return; }

    if (this._parseParty(msg)) return;

    // ---- friend request: "X has sent you a friend request!" / "Friend request from X" ----
    m = msg.match(P.friendReq1) || msg.match(P.friendReq2);
    if (m) { this.emit('friendRequest', m[1]); return; }

    // ---- direct messages: "From [rank] Name: text" / "To Name: text" ----
    m = msg.match(new RegExp('^From (?:\\[[^\\]]+\\]\\s*)*(' + NAME + '):\\s*(.*)$'));
    if (m) { this.emit('dmFrom', m[1], m[2]); return; }
    m = msg.match(new RegExp('^To (?:\\[[^\\]]+\\]\\s*)*(' + NAME + '):\\s*(.*)$'));
    if (m) { this.emit('dmTo', m[1]); return; }

    // ---- kill line carrying the killer's running lifetime final-kill count, e.g.
    //      "Victim was Killer's #3560 FINAL KILL!" — a possessive kill-line variant that
    //      some clients/servers show. This is speculative pending a real sample; the wording here
    //      matches what was described, so tune it once an actual log line is available.
    m = msg.match(new RegExp('^(?:\\[[^\\]]+\\]\\s*)*(' + NAME + ') was (?:\\[[^\\]]+\\]\\s*)*(' + NAME + ')\'s #?(\\d+)(?:st|nd|rd|th)?\\s+FINAL KILL', 'i'));
    if (m) { this.emit('finalKillCount', { victim: m[1], killer: m[2], count: parseInt(m[3], 10) }); }

    // ---- server / game change -> clear ----
    // Lunar (and maybe other clients with a similar "server info" feature - unconfirmed) drops a
    // raw status blob straight into chat on every server switch, e.g.
    // {"server":"dynamiclobby39C","gametype":"BEDWARS","lobbyname":"..."} or
    // {"server":"mini116CN","gametype":"BEDWARS","mode":"...","map":"..."}, or just
    // {"server":"limbo"} with no gametype at all for the hub. Verified against a real captured
    // log that "dynamiclobby*" (gametype BEDWARS) is actually a shared matchmaking staging pool -
    // dozens of unrelated players cycling through many simultaneous queues, not your actual game -
    // while "mini*" is the real, small match instance (confirmed real "The game starts in 10
    // seconds!" countdown and genuine teammate/opponent chat right after). main.js uses the raw
    // server code, not just the gametype, so it can tell those two apart.
    m = msg.match(/"server"\s*:\s*"([^"]+)"/);
    if (m) {
      const gt = msg.match(/"gametype"\s*:\s*"([^"]+)"/);
      this.emit('serverChange', { server: m[1], gametype: gt ? gt[1] : null });
      return;
    }
    // The "Bed Wars" banner line some clients were assumed to print never actually showed up in a
    // real captured log (same lesson as lobbyJoin's old pattern) - dropped rather than left in as
    // dead, unverified weight. "Sending you to X!"/"1st Killer"/"You are now in" are genuine
    // Hypixel-sent text (confirmed real, just don't carry a gametype), kept as a fallback for
    // whenever the JSON blob above isn't present.
    if (/^Sending you to /.test(msg) || /^\s*1st Killer/.test(msg) || /^You are now in /.test(msg)) {
      this.emit('serverChange', { server: undefined, gametype: undefined }); // unknown (see main.js)
      // don't return; a game-over line could still mention you
    }

    // ---- normal chat ("Rank Name: text" / "Rank Name [Guild tag]: text") - whoever's talking in
    // PUBLIC chat is obviously actually in the lobby/game with you, just as good a signal as a
    // who/join line (whose exact wording varies more than you'd hope - see the two lobbyJoin
    // patterns above) and not dependent on matching one particular message format. Guild/Party/
    // Officer/Co-op/Alliance chat is excluded from that, though - those channels reach people
    // anywhere on the network, not just your current lobby, so treating a guildmate chatting from
    // some other server as "here" would be actively wrong. Party chat specifically is redundant
    // with it anyway, since party members already get added via partyList/partyJoin. Requires a
    // real [CHAT] tag (see isChatLine above) so startup diagnostic dumps that just happen to look
    // like "Label: value" (OptiFine's "Capabilities:"/"OpenGL:"/"Renderer:"/... block, none of
    // which are ever chat-tagged) can't be mistaken for someone named "OpenGL" talking. ----
    const hasChannelPrefix = CHANNEL_PREFIX.test(msg);
    const body = msg.replace(CHANNEL_PREFIX, '');
    const cm = isChatLine && body.match(new RegExp('^' + CHAT_PREFIX + '(' + NAME + ')(?:\\s*\\[[^\\]]+\\])*\\s*:\\s*(.*)$'));
    if (cm) {
      if (!hasChannelPrefix) this.emit('chatSpeaker', cm[1]);
      // Anyone talking in party chat is, by definition, in your party right now - the most common
      // way members show up without anybody running /p list.
      else if (/^Party\s*>/i.test(msg) && !this._isSelf(cm[1])) this.emit('partyMember', cm[1]);
      if (this._selfRe && !this._isSelf(cm[1]) && this._selfRe.test(cm[2])) {
        this.emit('mention', { by: cm[1], text: cm[2] });
      }
    }
  }

  _isSelf(name) { return this.selfNames.includes(String(name).toLowerCase()); }

  // Everything party-related. Returns true once the line has been fully handled.
  _parseParty(msg) {
    let m;
    // /p list arrives as a block: "Party Members (N)", then Leader/Moderators/Members lines, then
    // a dash separator. Collect it so the complete list can be reconciled once all N are in.
    m = msg.match(P.rosterHeader);
    if (m) { this._roster = { expected: parseInt(m[1], 10), names: [] }; return true; }
    if (P.rosterLine.test(msg)) {
      const names = namesFrom(msg.slice(msg.indexOf(':') + 1));
      if (names.length) this.emit('partyList', names);
      if (this._roster) {
        this._roster.names.push(...names);
        // Only a list that accounts for every announced member is trusted to remove anyone - a
        // line we failed to parse must never make real members disappear.
        if (this._roster.names.length === this._roster.expected) { this.emit('partyRoster', this._roster.names); this._roster = null; }
      }
      return true;
    }
    if (this._roster && SEPARATOR.test(msg)) { this._roster = null; return false; }

    m = msg.match(P.youJoined);
    if (m) { this.emit('partyJoined', m[1]); return true; }
    m = msg.match(P.partyingWith);
    if (m) { const names = namesFrom(m[1]); if (names.length) this.emit('partyJoin', names); return true; }
    m = msg.match(P.memberJoined);
    if (m) { this.emit('partyJoin', [m[1]]); return true; }

    m = msg.match(P.invitedYou);
    if (m) { this.emit('partyInvite', m[1]); return true; }
    // "A invited B to the party!" - A is already in your party (B isn't until they accept).
    m = msg.match(P.invitedOther);
    if (m) { if (!this._isSelf(m[1])) this.emit('partyMember', m[1]); return true; }
    m = msg.match(P.summoned);
    if (m) { this.emit('partyMember', m[1]); return true; }
    m = msg.match(P.promoted);
    if (m) { for (const n of [m[1], m[2]]) if (!this._isSelf(n)) this.emit('partyMember', n); return true; }
    m = msg.match(P.transferredLeft);
    if (m) { if (!this._isSelf(m[1])) this.emit('partyMember', m[1]); this.emit('partyLeave', m[2]); return true; }
    m = msg.match(P.transferredBy);
    if (m) { for (const n of [m[1], m[2]]) if (!this._isSelf(n)) this.emit('partyMember', n); return true; }

    m = msg.match(P.left) || msg.match(P.removed) || msg.match(P.kickedOffline) || msg.match(P.disconnected);
    if (m) { this.emit('partyLeave', m[1]); return true; }
    if (P.disband.test(msg) || P.disbandedBy.test(msg)) { this.emit('partyDisband'); return true; }
    return false;
  }
}

module.exports = { LogWatcher, stripRank, chatOf, validName };
