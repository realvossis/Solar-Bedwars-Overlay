'use strict';
// Tails whatever Minecraft log file the user points us at — Lunar, OneClient, vanilla, Badlion,
// doesn't matter which — and turns the chat noise into the normalized events below.
// Also copes with the log getting rotated or truncated out from under us mid-read.
//
// Client differences handled here:
//  - encoding: Lunar writes the log in the JVM's platform charset (Latin-1 on Windows), OneClient
//    writes UTF-8. Each file's encoding is sniffed from its own bytes (see decodeLines).
//  - OneClient's HyChatter mod restyles some Hypixel lines before they reach the log: game joins
//    become "+ (3/16) Name", quits "- (2/16) Name", countdowns get a "⁎ " prefix, channel tags can be
//    shortened ("P >", "G >"), DMs become "PM < Name: hi" / "PM > Name: hi". ChatTweaks' compact
//    chat appends " (2)", " (3)" ... to repeated lines. Both styles are accepted everywhere.
//  - Lunar puts a {"server":...} /locraw blob in chat on every server switch; OneClient doesn't, so
//    server switches are also read from Hypixel's own "Sending you to ..." and lobby-join lines.
//
// What it emits:
//   who(names[])        - /who or accumulated pre-game lobby
//   lobbyJoin(name)     - "X has joined (n/m)!" or the real Bedwars "X joined the lobby!"
//   lobbyEntered(name)  - YOU joined a lobby ("[MVP++] You joined the lobby!") - a lobby, not a game
//   sessionUser(name)   - the account the game was launched with ("Setting user: Name")
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
//   serverChange(info)  - sent to a new server: { server, gametype, mode, map, via } - via 'locraw'
//                         (exact, from the JSON blob) or 'chat' (server name only, gametype unknown);
//                         server undefined = switched, but to where is unknown (game over etc.)
//   matchStarting()     - "The game starts in 1 second!"
//   matchStart()        - the Bedwars start banner ("Protect your bed and destroy the enemy beds.")
//   matchEnd(reason)    - you were eliminated (leaving/game over arrive as serverChange)
const fs = require('fs');
const { EventEmitter } = require('events');

const NAME = '[A-Za-z0-9_]{1,16}';
const stripColors = (s) => s.replace(/§[0-9a-fk-or]/gi, '').replace(/§[0-9a-fk-or]/gi, '');
const stripRank = (s) => s.trim().replace(/^(?:\[[^\]]+\]\s*)+/, '').replace(/[^A-Za-z0-9_].*$/, '').trim();
// Guild/Party/Officer chat lines put a "Guild > " style channel tag before the
// rank+name, e.g. "Guild > [VIP] Name: text" — strip it before matching the
// sender so mentions in those channels aren't missed (public chat has no tag).
// HyChatter's "short channel names" turns those into single letters ("P > ", "G > ").
const CHANNEL_PREFIX = /^(?:Guild|Party|Officer|Co-op|Alliance|Friend|[PGOF])\s*>\s*/i;
const PARTY_CHANNEL = /^(?:Party|P)\s*>/i;
// ChatTweaks (OneClient) marks a repeated line with " (2)", " (3)", ... at the end.
const COMPACT_SUFFIX = /\s\(\d{1,4}\)$/;
// Decorations clients put in front of Hypixel's own system lines (HyChatter: "⁎ The game starts in").
const SYS_DECOR = /^[⁎•·*]\s+/;
// Words that start real system lines in the "Label: value" shape ("Opponent: [MVP+] X") - never a
// player talking, so never a chat speaker.
const NOT_SPEAKERS = new Set(['opponent', 'opponents', 'winner', 'winners', 'map', 'mode', 'server', 'team', 'teams', 'teammate', 'teammates',
  'reward', 'rewards', 'tip', 'note', 'lobby', 'status', 'total', 'party', 'kit', 'kills', 'online', 'friend', 'guild']);

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
// Titles shown in front of the rank in some lobbies ("Bridge Legend V [MVP++] Name: hi",
// "[SPECTATOR] Overlord [MVP+] Name: gg") are accepted too, but only directly before a [RANK]
// bracket, so a plain "Label: value" system line can't pass as someone talking.
const CHAT_PREFIX = '(?:(?:\\[[^\\]]+\\]|«[^»]{0,24}»|[^\\[\\]:«»\\s][^\\[\\]:«»]{0,39}\\s(?=\\[))\\s*)*';
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

// Game join/quit lines, Hypixel's own wording and HyChatter's restyled ones. Anchored at both ends
// (after the compact-chat counter is removed), so a player typing "+ Bob: hi" can never match.
const COUNT = '\\(\\s*\\d+\\s*\\/\\s*\\d+\\s*\\)';
const JOIN = [
  new RegExp('^' + RANKS + '(' + NAME + ') has joined(?: ' + COUNT + ')?!(?:\\s*' + COUNT + ')?$'),
  new RegExp('^\\+\\s*' + COUNT + '\\s*' + RANKS + '(' + NAME + ')$'),
  new RegExp('^\\+\\s*' + RANKS + '(' + NAME + ')(?:\\s*' + COUNT + ')?$'),
];
const QUIT = [
  new RegExp('^' + RANKS + '(' + NAME + ') has quit!(?:\\s*' + COUNT + ')?$'),
  new RegExp('^-\\s*' + COUNT + '\\s*' + RANKS + '(' + NAME + ')$'),
  new RegExp('^-\\s*' + RANKS + '(' + NAME + ')(?:\\s*' + COUNT + ')?$'),
];
// "[MVP++] Name joined the lobby!", ">>> ... <<<" for top ranks, and Hypixel's seasonal wordings.
const LOBBY_JOIN = new RegExp('^(?:>>>\\s*)?' + RANKS + '(' + NAME + ')\\s+(?:joined|sled into|slid into|spooked into) the lobby!');

// Splits a byte buffer into complete lines (the unfinished tail stays behind for the next read) and
// decodes them. A UTF-8 file is recognised by its first non-ASCII bytes forming valid UTF-8
// (Latin-1 text practically never does); the verdict sticks for that file.
const utf8Strict = new TextDecoder('utf-8', { fatal: true });
function decodeLines(buf, state) {
  const end = buf.lastIndexOf(0x0a);
  if (end < 0) return { lines: [], rest: buf };
  const body = buf.subarray(0, end + 1);
  if (!state.encoding) {
    let high = false;
    for (let i = 0; i < body.length; i++) if (body[i] >= 0x80) { high = true; break; }
    if (high) { try { utf8Strict.decode(body); state.encoding = 'utf8'; } catch (_) { state.encoding = 'latin1'; } }
  }
  const text = body.toString(state.encoding === 'utf8' ? 'utf8' : 'latin1');
  const lines = text.split(/\r?\n/);
  lines.pop(); // the empty string after the final newline
  return { lines, rest: Buffer.from(buf.subarray(end + 1)) };
}

class LogWatcher extends EventEmitter {
  constructor() {
    super();
    this.path = null;
    this.pos = 0;
    this.ino = 0;
    this.watcher = null;
    this.timer = null;
    this.buffer = Buffer.alloc(0);
    this.decode = { encoding: null }; // per file, see decodeLines
    this._reading = false;
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
    this.decode = { encoding: null };
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
    this.timer = null; this.buffer = Buffer.alloc(0); this._roster = null;
  }

  // Feeds raw bytes (as read from the file) through line splitting + decoding + parsing.
  _feed(bytes) {
    const { lines, rest } = decodeLines(this.buffer.length ? Buffer.concat([this.buffer, bytes]) : bytes, this.decode);
    // A single runaway line (binary junk, a huge stack trace without newlines) can't grow forever.
    this.buffer = rest.length > 1 << 20 ? Buffer.alloc(0) : rest;
    for (const l of lines) this._parse(l);
  }

  _poll() {
    if (this._reading) return;
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
    const rotated = (this.ino && st.ino && st.ino !== this.ino) || st.size < this.pos; // new file / truncated in place
    if (rotated) { this.pos = 0; this.buffer = Buffer.alloc(0); this.decode = { encoding: null }; }
    this.ino = st.ino;
    if (st.size === this.pos) return;
    // Raw bytes, decoded per file (see decodeLines): Lunar's Latin-1 log decoded as UTF-8 would turn
    // every §-colour byte into a replacement char, and OneClient's UTF-8 log decoded as Latin-1 would
    // turn every § into "Â§" - either way rank/name parsing in coloured chat silently breaks.
    const start = this.pos, end = st.size, me = this.path;
    this._reading = true;
    fs.open(me, 'r', (err, fd) => {
      if (err) { this._reading = false; return; }
      const len = Math.min(end - start, 8 << 20); // at most 8 MB per poll; the rest comes next poll
      const buf = Buffer.alloc(len);
      fs.read(fd, buf, 0, len, start, (rerr, n) => {
        fs.close(fd, () => {});
        this._reading = false;
        if (rerr || this.path !== me || this.pos !== start) return; // switched files / restarted meanwhile
        this.pos = start + n;
        this._feed(buf.subarray(0, n));
      });
    });
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
    // The same message without OneClient's compact-chat counter and system-line decoration, for
    // the patterns that are anchored at the end or start with a fixed phrase.
    const sys = msg.replace(COMPACT_SUFFIX, '').replace(SYS_DECOR, '');

    // ---- the account the game runs as - a plain log line, never chat (so chat can't fake it) ----
    if (!isChatLine) {
      const u = msg.match(/^Setting user: ([A-Za-z0-9_]{1,16})$/);
      if (u) { this.emit('sessionUser', u[1]); return; }
    }
    // HyChatter's terse "+ Name" / "- Name" forms only ever arrive as chat; never read them out of
    // other log lines (a mod list like "- somemod" would otherwise look like a quit).
    const joinForms = isChatLine ? JOIN : JOIN.slice(0, 1);
    const quitForms = isChatLine ? QUIT : QUIT.slice(0, 1);

    // ---- /who or auto-who: "ONLINE: a, b, c" ----
    let m = msg.match(/^ONLINE:\s*(.+)$/);
    if (m) {
      const names = m[1].split(',').map((s) => stripRank(s)).filter(validName);
      if (names.length) this.emit('who', names);
      return;
    }

    // ---- pre-game lobby fill: "Name has joined (1/16)!", OneClient: "+ (01/16) Name" ----
    for (const re of joinForms) { m = sys.match(re); if (m) { this.emit('lobbyJoin', m[1], 'game'); return; } }

    // ---- lobby joins: "[rank] Name joined the lobby!", ">>> [MVP++] Name joined the lobby! <<<".
    // Yours means you're in a lobby (no game instance ever shows these); anyone else's is a lobby-mate.
    m = msg.match(LOBBY_JOIN);
    if (m) { if (this._isSelf(m[1])) this.emit('lobbyEntered', m[1]); else this.emit('lobbyJoin', m[1], 'lobby'); return; }

    // ---- match lifecycle (drives "hide overlay during matches"). Exact Hypixel system lines, verified
    // against real logs; anchored, so nobody can fake them in chat (chat starts with the sender). ----
    if (/^The game starts in 1 second!/.test(sys)) { this.emit('matchStarting'); return; }
    if (/^Protect your bed and destroy the enemy beds\./.test(sys)) { this.emit('matchStart', 'BEDWARS'); return; }
    if (/^You have been eliminated!/.test(sys)) { this.emit('matchEnd', 'eliminated'); return; }

    // ---- quit: "Name has quit!", OneClient: "- (02/16) Name" ----
    for (const re of quitForms) { m = sys.match(re); if (m) { this.emit('quit', m[1]); return; } }

    // ---- Housing: "Attempting to teleport you to [Rank] Name's house..." — the only real
    // clue to who the house belongs to, since Housing has no lobby-fill/kill-feed messages
    // the way Bedwars does. Verified against a real captured log line. ----
    m = msg.match(new RegExp('^Attempting to teleport you to (?:\\[[^\\]]+\\]\\s*)*(' + NAME + ')\'s house'));
    if (m) { this.emit('houseEntered', m[1]); return; }

    // Unstripped: "Party Members (4)" ends in what looks like a compact-chat counter.
    if (this._parseParty(msg)) return;

    // ---- friend request: "X has sent you a friend request!" / "Friend request from X" ----
    m = msg.match(P.friendReq1) || msg.match(P.friendReq2);
    if (m) { this.emit('friendRequest', m[1]); return; }

    // ---- direct messages: "From [rank] Name: text" / "To Name: text", OneClient "PM < Name: text" ----
    m = msg.match(new RegExp('^(?:From|PM\\s*<)\\s*' + RANKS + '(' + NAME + '):\\s*(.*)$'));
    if (m) { this.emit('dmFrom', m[1], m[2].replace(COMPACT_SUFFIX, '')); return; }
    m = msg.match(new RegExp('^(?:To|PM\\s*>)\\s*' + RANKS + '(' + NAME + '):\\s*(.*)$'));
    if (m) { this.emit('dmTo', m[1]); return; }

    // ---- kill line carrying the killer's running lifetime final-kill count, e.g.
    //      "Victim was Killer's #3560 FINAL KILL!" — a possessive kill-line variant that
    //      some clients/servers show. This is speculative pending a real sample; the wording here
    //      matches what was described, so tune it once an actual log line is available.
    m = msg.match(new RegExp('^(?:\\[[^\\]]+\\]\\s*)*(' + NAME + ') was (?:\\[[^\\]]+\\]\\s*)*(' + NAME + ')\'s #?(\\d+)(?:st|nd|rd|th)?\\s+FINAL KILL', 'i'));
    if (m) { this.emit('finalKillCount', { victim: m[1], killer: m[2], count: parseInt(m[3], 10) }); }

    // ---- server / game change -> clear ----
    // Lunar drops the /locraw status blob straight into chat on every server switch, e.g.
    // {"server":"dynamiclobby39C","gametype":"BEDWARS","lobbyname":"..."} or
    // {"server":"mini116CN","gametype":"BEDWARS","mode":"...","map":"..."}, or just
    // {"server":"limbo"} with no gametype at all for the hub. Verified against a real captured
    // log that "dynamiclobby*" (gametype BEDWARS) is actually a shared matchmaking staging pool -
    // dozens of unrelated players cycling through many simultaneous queues, not your actual game -
    // while "mini*" is the real, small match instance (confirmed real "The game starts in 10
    // seconds!" countdown and genuine teammate/opponent chat right after). main.js uses the raw
    // server code, not just the gametype, so it can tell those two apart.
    // Anchored: the real blob is the whole message, while anything a player types follows their
    // name, so chat can't fake a server switch (or feed a made-up mode/map in).
    m = msg.match(/^\{\s*"server"\s*:\s*"([^"]+)"/);
    if (m) {
      const gt = msg.match(/"gametype"\s*:\s*"([^"]+)"/);
      // "mode" is only present on an actual game instance (e.g. BEDWARS_FOUR_FOUR, DUELS_SUMO_DUEL),
      // never on a lobby - that's how "in a game" is told apart from "in a lobby".
      const md = msg.match(/"mode"\s*:\s*"([^"]+)"/);
      const mp = msg.match(/"map"\s*:\s*"([^"]+)"/);
      this.emit('serverChange', { server: m[1], gametype: gt ? gt[1] : null, mode: md ? md[1] : null, map: mp ? mp[1] : null, via: 'locraw' });
      return;
    }
    // Hypixel's own "Sending you to mini114BA!" names the server you're being moved to - every
    // client shows it, so it's how OneClient (no /locraw blob) learns about switches. It can't say
    // which game it is; main.js fills that in. "1st Killer"/"You are now in" mean a switch to
    // somewhere unknown.
    m = sys.match(/^Sending you to ([A-Za-z0-9_-]{2,40})(?:!|\.\.\.|\.)?$/);
    if (m) { this.emit('serverChange', { server: m[1], gametype: undefined, mode: undefined, map: undefined, via: 'chat' }); return; }
    if (/^\s*1st Killer/.test(msg) || /^You are now in /.test(msg)) {
      this.emit('serverChange', { server: undefined, gametype: undefined, via: 'chat' }); // unknown (see main.js)
      // don't return; a game-over line could still mention you
    }

    // ---- normal chat ("Rank Name: text" / "Rank Name [Guild tag]: text") - whoever's talking in
    // PUBLIC chat is obviously actually in the lobby/game with you, just as good a signal as a
    // who/join line (whose exact wording varies more than you'd hope - see the join patterns
    // above) and not dependent on matching one particular message format. Guild/Party/
    // Officer/Co-op/Alliance chat is excluded from that, though - those channels reach people
    // anywhere on the network, not just your current lobby, so treating a guildmate chatting from
    // some other server as "here" would be actively wrong. Party chat specifically is redundant
    // with it anyway, since party members already get added via partyList/partyJoin. Requires a
    // real [CHAT] tag (see isChatLine above) so startup diagnostic dumps that just happen to look
    // like "Label: value" (OptiFine's "Capabilities:"/"OpenGL:"/"Renderer:"/... block, none of
    // which are ever chat-tagged) can't be mistaken for someone named "OpenGL" talking. ----
    if (!isChatLine) return;
    const hasChannelPrefix = CHANNEL_PREFIX.test(msg);
    const body = msg.replace(CHANNEL_PREFIX, '');
    const cm = body.match(new RegExp('^' + CHAT_PREFIX + '(' + NAME + ')(?:\\s*\\[[^\\]]+\\])*\\s*:\\s*(.*)$'));
    if (cm) {
      const text = cm[2].replace(COMPACT_SUFFIX, '');
      if (NOT_SPEAKERS.has(cm[1].toLowerCase())) return; // a system line shaped like chat
      if (!hasChannelPrefix) this.emit('chatSpeaker', cm[1]);
      // Anyone talking in party chat is, by definition, in your party right now - the most common
      // way members show up without anybody running /p list.
      else if (PARTY_CHANNEL.test(msg) && !this._isSelf(cm[1])) this.emit('partyMember', cm[1]);
      if (this._selfRe && !this._isSelf(cm[1]) && this._selfRe.test(text)) {
        this.emit('mention', { by: cm[1], text });
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

module.exports = { LogWatcher, stripRank, chatOf, validName, decodeLines };
