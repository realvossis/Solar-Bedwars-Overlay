'use strict';
// Where on Hypixel you are right now, merged from every source a client gives us:
//
//   locraw - Lunar's {"server":...,"gametype":...,"mode":...} blob (exact; Lunar only)
//   api    - Hypixel's /status for your own account (exact game + mode, no server name)
//   chat   - Hypixel's own lines, on every client: "Sending you to mini114BA!" (a game server),
//            "[MVP++] You joined the lobby!" / anyone else's lobby join (a lobby)
//
// The same switch usually shows up more than once (Lunar prints "Sending you to X!" and then the
// blob for X a moment later). signal() tells those apart: 'change' is a real switch (clear the
// list, reset alerts...), 'enrich' only adds detail to the current place (e.g. which game it is),
// 'ignore' is a repeat. place.kind is 'lobby' | 'game' | 'limbo' | 'unknown'.
const RECENT_MS = 15000;
// Straggler lobby-join lines from the lobby you just left must not undo a fresh switch to a game.
const STRAGGLER_MS = 3000;

const isGameServer = (s) => /^(mini|mega)/i.test(String(s || ''));
const kindOf = (info) => {
  if (info.server === 'limbo') return 'limbo';
  if (info.via === 'chat') return info.lobby ? 'lobby' : isGameServer(info.server) ? 'game' : 'lobby';
  return info.mode && info.mode !== 'LOBBY' ? 'game' : 'lobby';
};

class Locator {
  constructor(now = Date.now) {
    this.now = now;
    this.gen = 0; // bumps on every real change; async lookups use it to notice they're stale
    this.place = { server: undefined, gametype: null, mode: null, map: null, kind: 'unknown', via: null, at: 0 };
  }

  reset() {
    this.gen++;
    this.place = { server: undefined, gametype: null, mode: null, map: null, kind: 'unknown', via: null, at: 0 };
  }

  // info: { via: 'locraw'|'api'|'chat', server?, gametype?, mode?, map?, lobby?: true, self?: true }
  signal(info) {
    const p = this.place, t = this.now(), kind = kindOf(info);
    const recent = t - p.at < RECENT_MS;
    const sameSpot = kind === p.kind && (kind !== 'game' || !info.server || !p.server || info.server === p.server);

    if (info.via === 'api') {
      // No server name in /status - it can only describe the place we already know we're in.
      if (!sameSpot || p.via === 'locraw') return 'ignore';
      this._fill(info, kind);
      return 'enrich';
    }
    if (info.via === 'chat') {
      if (info.lobby) {
        if (p.kind === 'lobby' || p.kind === 'limbo') return 'ignore';
        if (!info.self && p.kind === 'game' && t - p.at < STRAGGLER_MS) return 'ignore';
      } else if (sameSpot && recent) return 'ignore'; // "Sending you to X!" (2) - a repeat
      if (p.via !== 'chat' && p.via && recent && sameSpot) return 'ignore'; // already known exactly
      this.gen++;
      this.place = { server: info.lobby ? 'lobby' : info.server, gametype: null, mode: null, map: null, kind, via: 'chat', at: t };
      return 'change';
    }
    // locraw: exact. Fills in what chat already announced; otherwise it's a switch of its own.
    if (p.via === 'chat' && recent && (sameSpot || (kind === 'lobby' && p.kind === 'lobby'))) {
      p.server = info.server;
      this._fill(info, kind);
      p.via = 'locraw';
      return 'enrich';
    }
    if (p.via === 'locraw' && info.server === p.server && (info.mode || null) === p.mode) return 'ignore';
    this.gen++;
    this.place = { server: info.server, gametype: info.gametype || null, mode: kind === 'game' ? info.mode || null : null, map: info.map || null, kind, via: 'locraw', at: t };
    return 'change';
  }

  // The Bed Wars start banner settles which game this is, whatever else said so far.
  gameStarted(gametype) {
    const p = this.place;
    if (p.kind === 'game' && !p.gametype) { p.gametype = gametype; return true; }
    return false;
  }

  _fill(info, kind) {
    const p = this.place;
    if (info.gametype) p.gametype = info.gametype;
    p.mode = kind === 'game' ? (info.mode || p.mode) : null;
    if (info.map) p.map = info.map;
    if (info.via === 'api' && p.via === 'chat') p.via = 'api';
  }

  // The bits main.js keys off. mode is 'UNKNOWN' for a game whose mode nobody has reported yet.
  get server() { return this.place.server; }
  get gametype() { return this.place.gametype; }
  get mode() { return this.place.kind === 'game' ? (this.place.mode || 'UNKNOWN') : null; }
  get inGameServer() { return this.place.kind === 'game'; }
}

// Human-readable place for the overlay's status pill.
const GAMES = { BEDWARS: 'Bed Wars', DUELS: 'Duels', SKYWARS: 'SkyWars', HOUSING: 'Housing', MURDER_MYSTERY: 'Murder Mystery', BUILD_BATTLE: 'Build Battle',
  ARCADE: 'Arcade', SKYBLOCK: 'SkyBlock', PIT: 'The Pit', TNTGAMES: 'TNT Games', UHC: 'UHC', MCGO: 'Cops and Crims', WOOL_GAMES: 'Wool Games', PROTOTYPE: 'Prototype' };
function describe(place, inMatch, modes = {}) {
  if (!place || place.kind === 'unknown') return null;
  if (place.kind === 'limbo') return 'Limbo';
  const game = place.gametype ? (GAMES[place.gametype] || place.gametype.charAt(0) + place.gametype.slice(1).toLowerCase().replace(/_/g, ' ')) : null;
  if (place.kind === 'lobby') return game ? game + ' lobby' : 'Lobby';
  const mode = modes[place.mode] && modes[place.mode].name;
  // Short enough for the overlay's title bar: "Doubles pre-game", then "Bed Wars Doubles" once it starts.
  if (!inMatch) return mode ? mode + ' pre-game' : game ? game + ' pre-game' : 'Pre-game';
  return [game, mode].filter(Boolean).join(' ') || 'In game';
}

module.exports = { Locator, describe, isGameServer, GAMES };
