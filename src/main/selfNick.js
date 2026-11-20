'use strict';
// Learns your own nick from the log. Nothing announces it, but it has a fingerprint: right after
// "Sending you to ..." the first join line you see is your own arrival (players already in that
// lobby aren't announced). A name that is the only unknown name in that arrival burst in TWO
// separate games is you - a stranger never repeats like that, your nick does every game.
//
// Never mistaken for a teammate: your own join is always in your burst, so a nicked teammate
// warping in with you means two unknown names (doesn't count). And once anyone in the burst is
// already known to be you, the burst teaches nothing (the rest are other people).
const WINDOW_MS = 1500;

class SelfNick {
  constructor(now = Date.now) {
    this.now = now;
    this.nick = null;
    this.arrival = null;
    this.hits = new Map();
  }

  // You just landed on a game server.
  arrived() { this.arrival = { at: this.now(), names: new Set() }; }

  // A game join line ("+ (2/16) Name" / "Name has joined (2/16)!").
  joined(name) {
    if (this.arrival && this.now() - this.arrival.at <= WINDOW_MS) this.arrival.names.add(String(name));
  }

  // After the window: isMe(name) -> already known to be you; party = lower-case names in your party.
  // Returns the newly learned nick, or null.
  judge(isMe, party = new Set()) {
    const a = this.arrival; this.arrival = null;
    if (!a || !a.names.size) return null;
    const names = [...a.names];
    if (names.some(isMe)) return null;
    const others = names.filter((n) => !party.has(n.toLowerCase()));
    if (others.length !== 1) return null;
    const k = others[0].toLowerCase(), hits = (this.hits.get(k) || 0) + 1;
    this.hits.set(k, hits);
    if (hits < 2 || (this.nick && this.nick.toLowerCase() === k)) return null;
    this.nick = others[0];
    return this.nick;
  }
}

module.exports = { SelfNick, WINDOW_MS };
