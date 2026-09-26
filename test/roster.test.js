'use strict';
// Roster source-priority and party-membership tests. Run: npm test
const assert = require('assert');
const { Roster } = require('../src/main/roster');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ok  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' -> ' + e.message); } }

// No network: lookups resolve to "nicked" instantly, which is all these tests need.
const fakeHy = { resolveUuid: async () => null };
const make = () => new Roster(fakeHy, {}, () => ({ concurrency: 1 }));
const src = (r, n) => (r.players.get(n.toLowerCase()) || {}).source;

t('inviter becomes PARTY once you join (was lost before)', () => {
  const r = make();
  r.addNames(['Leader'], 'partyInvite');
  r.addNames(['Leader'], 'PARTY');
  assert.strictEqual(src(r, 'Leader'), 'PARTY');
  r.clear();
  assert.strictEqual(src(r, 'Leader'), 'PARTY');
});
t('lobby-mate who joins your party is upgraded and survives clear', () => {
  const r = make();
  r.addNames(['Mate'], 'GAME'); r.addNames(['Mate'], 'PARTY'); r.clear();
  assert.strictEqual(src(r, 'Mate'), 'PARTY');
});
t('weaker signals never downgrade', () => {
  const r = make();
  r.addNames(['P'], 'PARTY'); r.addNames(['P'], 'GAME'); r.addNames(['P'], 'mention');
  assert.strictEqual(src(r, 'P'), 'PARTY');
});
t('SELF is never overridden by party events', () => {
  const r = make();
  r.setSelf('Me', false); r.addNames(['Me'], 'PARTY'); r.setParty(['Other']);
  assert.strictEqual(src(r, 'Me'), 'SELF');
});
t('leaveParty demotes to GAME, next clear removes', () => {
  const r = make();
  r.addNames(['Gone'], 'PARTY'); r.leaveParty('gone');
  assert.strictEqual(src(r, 'Gone'), 'GAME');
  r.clear();
  assert.strictEqual(src(r, 'Gone'), undefined);
});
t('disbandParty demotes every member', () => {
  const r = make();
  r.addNames(['A', 'B'], 'PARTY'); r.disbandParty();
  assert.deepStrictEqual([src(r, 'A'), src(r, 'B')], ['GAME', 'GAME']);
});
t('setParty reconciles to exactly the listed members', () => {
  const r = make();
  r.addNames(['Old', 'Stay'], 'PARTY'); r.setParty(['Stay', 'New']);
  assert.deepStrictEqual([src(r, 'Old'), src(r, 'Stay'), src(r, 'New')], ['GAME', 'PARTY', 'PARTY']);
});
t('quit marks a lobby player as left, rejoining clears it', () => {
  const r = make();
  r.addNames(['Q'], 'GAME'); r.markLeft('Q');
  assert.strictEqual(r.players.get('q').left, true);
  r.addNames(['Q'], 'GAME');
  assert.strictEqual(r.players.get('q').left, false);
});
t('party members are never marked as left', () => {
  const r = make();
  r.addNames(['P'], 'PARTY'); r.markLeft('P');
  assert.ok(!r.players.get('p').left);
});

t('Name Watch: new players are matched and announced once', () => {
  const r = make(); const seen = [];
  r.on('nameMatch', (row) => seen.push(row.name));
  r.setMatcher((n) => (/cat/i.test(n) ? ['cat'] : []));
  r.addNames(['CatLover', 'Dog'], 'GAME'); r.addNames(['CatLover'], 'GAME');
  assert.deepStrictEqual(r.players.get('catlover').nameMatch, ['cat']);
  assert.deepStrictEqual(r.players.get('dog').nameMatch, []);
  assert.deepStrictEqual(seen, ['CatLover']);
});
t('Name Watch: changing rules re-checks existing rows silently', () => {
  const r = make(); const seen = [];
  r.on('nameMatch', (row) => seen.push(row.name));
  r.addNames(['Dog'], 'GAME');
  r.setMatcher((n) => (n === 'Dog' ? ['Dog'] : []));
  assert.deepStrictEqual(r.players.get('dog').nameMatch, ['Dog']);
  r.setMatcher(null);
  assert.deepStrictEqual(r.players.get('dog').nameMatch, []);
  assert.deepStrictEqual(seen, []);
});

// Async ones: let the lookup queue run.
const settle = () => new Promise((r) => setTimeout(r, 30));
(async () => {
  await (async () => {
    const r = make(); const loaded = [];
    r.on('loaded', (row) => loaded.push(row));
    r.addNames(['SomeNick'], 'GAME'); await settle();
    t('a nick (no Mojang account) is flagged and announced for the nick alert', () => {
      assert.strictEqual(r.players.get('somenick').nicked, true);
      assert.deepStrictEqual(loaded.map((x) => x.name), ['SomeNick']);
    });
  })();
  await (async () => {
    const r = new Roster({ resolveUuid: async () => { throw new Error('mojang rate limit'); } }, {}, () => ({ concurrency: 1 }));
    const loaded = []; r.on('loaded', (row) => loaded.push(row));
    r.addNames(['RealPlayer'], 'GAME'); await settle();
    t('a Mojang outage is an error, never a false "nicked"', () => {
      const row = r.players.get('realplayer');
      assert.ok(!row.nicked); assert.match(row.error, /rate limit/); assert.strictEqual(loaded.length, 0);
    });
  })();
  // Nick detection with a real Mojang account behind the name.
  const ur = { lookup: async () => ({ tags: [], severity: 0 }), monthlyDelta: async () => null, winstreaks: async () => null };
  const mk = (fetchPlayer) => new Roster({ resolveUuid: async (n) => ({ id: 'a'.repeat(32), name: n }), fetchPlayer, monthlyBaseline: () => null }, ur, () => ({ concurrency: 1 }));
  await (async () => {
    const r = mk(async () => null); // Hypixel: success, but no player record
    r.addNames(['EzraMorales2003'], 'GAME'); await settle();
    t('real Minecraft account that never played on Hypixel = nick', () => {
      const row = r.players.get('ezramorales2003');
      assert.strictEqual(row.nicked, true); assert.match(row.nickReason, /never played on Hypixel/);
    });
  })();
  await (async () => {
    const r = mk(async () => { const e = new Error('BAD_KEY'); e.code = 403; throw e; });
    r.addNames(['SomePlayer'], 'GAME'); await settle();
    t('no/bad API key proves nothing: not a nick', () => {
      const row = r.players.get('someplayer');
      assert.ok(!row.nicked); assert.strictEqual(row.apiError, 'bad key');
    });
  })();
  await (async () => {
    const r = mk(async () => ({ displayname: 'Regular', stats: { Bedwars: { Experience: 50000 } } }));
    r.addNames(['Regular'], 'GAME'); await settle();
    t('a normal Hypixel player is not a nick', () => { assert.ok(!r.players.get('regular').nicked); });
  })();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
