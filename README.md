# Solar Overlay

A lightweight Hypixel **Bedwars** overlay — Cubelify-style, but fully self-hosted and configurable.
Zero runtime dependencies (just Electron), live Hypixel stats, a self-hosted **sniper/threat score**,
**Urchin blacklist** integration with support for your own extra data sources, screen-capture hiding,
and a full settings + admin UI. Every column can be added, removed, reordered, and re-sourced —
nothing about the layout is fixed.

---

## Quick start

```bash
cd solar-overlay
cp src/main/secrets.example.js src/main/secrets.js   # then paste your keys into it
npm install        # installs Electron only
npm start          # launches the overlay
npm test           # runs the unit tests (stats, log parsing, roster, config)
```

> **Keys / secrets.** `src/main/secrets.js` is **gitignored** and holds your Hypixel + Urchin
> keys. It never gets committed. You can skip this file entirely and just paste keys in-app under
> **Settings → API Keys** (those save to Electron's `userData`, also outside the repo). The
> overlay works before you set any keys at all — the bundled blacklist and log-based player
> detection don't need one; a Hypixel key just unlocks live stats.

On first launch the overlay appears top-left. Drag it by the title bar. It also lives in your
system tray.

**Global shortcuts**

| Key | Action |
|-----|--------|
| `Alt+B` | Show / hide the overlay (works in every overlay mode) |
| `Alt+X` | Toggle click-through (mouse passes to the game) |
| `Alt+C` | Clear the player list |
| `Alt+S` | Open settings |
| `Alt+N` | Start / stop the nick roller |
| `Alt+T` | Test notification in-game (+ visibility diagnostics) |
| `Alt+N` | Start / stop the nick roller |

---

## First-time setup (Settings — `Alt+S` or the ⚙ button)

1. **General → Your IGN.** Set your username so the overlay knows who "you" are (mentions, hide-self).
2. **Log & Detection → Log file path.** Point it at your client log and click *Browse…*.
   Default guesses cover Lunar (`.lunarclient/profiles/<version>/logs/latest.log`, 1.8 first), vanilla, and Badlion.
   Players are auto-added when you `/who`, join a party, get invites/DMs, or get mentioned in chat —
   all of that is on by default, nothing to flip on manually.
3. **API Keys → Hypixel key.** Paste your key and hit **Test** to confirm it.
   (Personal keys allow 300 req / 5 min — the app rate-limits itself to stay under that. If you
   have an approved app key, paste it here; raise the cap in code via `hypixel.setRateLimit`.)
4. **Connections → Urchin.** On by default. Its endpoint/key/sources live under **API Keys → Urchin**;
   toggle it off in Connections if you'd rather run only your own data sources.

---

## Features

### Stats columns
`Tag · Lvl(★) · Player · FKDR · WLR · F.Kills · Wins · WS · M.FKDR · Sniper · Last Login · BL` by default —
but every one of these, Player included, can be removed and added back in **Settings → Columns**.
Nothing is pinned.

- **Click a header** to sort. **Drag headers** to reorder. **Right-click a header** to toggle columns.
- Hover any row for a full breakdown tooltip (finals, games, network level, monthly finals tracked, all tags).

### Custom & catalog columns
Beyond the defaults, **Settings → Columns** lets you:
- **Add any stat as a column** by dot-path into the raw Hypixel player object (e.g.
  `stats.Bedwars.beds_broken_bedwars`), with your own label.
- **Flip on a curated catalog** of extra stats grouped by gamemode (Bedwars, Skywars, Duels,
  Murder Mystery, general account info) without needing to know the raw API field names — all off
  by default, one toggle each.
- **Map any column to a Connection** instead of its normal source, under "Column data sources" —
  point `Tag`/`BL` at a specific connection's tags only, or pull a stat like `M.FKDR` straight from
  your own tracker's response instead of Hypixel's.

### Monthly FKDR
Hypixel has no native monthly stat, so the app stores one **snapshot per player per day** and computes
the delta over the last ~30 days. It shows `—` until enough history accrues (a day or two of seeing a player).

### Sniper / Threat score (your own evaluation)
A transparent 0–100 blend of FKDR, star, WLR, win streak, **recent-sweat trend** (monthly vs lifetime
FKDR), **account plausibility** (high star + low network level = likely alt), a **fresh-account
signal** (an account that's already good despite joining recently — the classic smurf tell),
**recent login**, and **blacklist tags**. FKDR, blacklist tags, and the account-plausibility signals
carry the most weight by default, since those are the strongest "real threat" indicators.
Labels: `CHILL → DECENT → SWEAT → TRYHARD → DANGER → SNIPER`. Every weight is a slider in
**Settings → Sniper Score**.

### Row highlight
Flags an entire row once a chosen stat clears a threshold — FKDR ≥ 8 by default, but any column
(built-in, custom, or catalog) can be picked instead, in **Settings → Appearance**.

### Urchin blacklist + bundled local import
- Live lookups hit your fully-configurable Urchin endpoint and render tags as colored chips.
- A bundled local blacklist import (`legit_sniper`/`caution`/`account`/`info` tags) ships at
  `data/blacklist.json` — **9,014 UUIDs / 9,349 tags** — and merges into every lookup, tagged `[local-import]`.
- Right-click a player → add a personal local `info` tag, or flag them to your watchlist.

### Connections (Settings → Connections)
Every tag/blacklist source in one place. Urchin ships built-in and on by default, but is just a
toggle away from being turned off. Add your own endpoints with the same
`{id} {uuid} {name} {key} {sources}` placeholder scheme, then map any of them onto a column under
**Settings → Columns → Column data sources**.

### Blacklist Admin (⚑) — for accounts with add-tag perms
Look up a player, then submit a tag (`cheater / sniper / caution / info / toxic / custom`) with a reason,
`hide_username`, and `overwrite` options. Posts to `{{adminBase}}/admin/add-tag`. Needs an admin key.

### Automatic party tracking
Your party is kept on the list (green rows, pinned under you) without ever running `/p list`.
It's built from every signal Hypixel sends: accepting an invite (the leader is added straight away),
"You'll be partying with…", members joining, **anyone talking in party chat**, summons, promotions
and transfers. Leaves, kicks and disbands take people back off. Running `/p list` still works and
is treated as the authoritative roster — but only when every member it announces was parsed, so a
misread line can never drop a real member. All patterns are anchored to Hypixel's own system
messages, so nobody can fake a party join by typing it in public chat.

Players who leave the pre-game lobby ("X has quit!") stay listed but faded. The title bar shows
your party size and a ⚠ count of threats in the lobby (blacklisted, or sniper score ≥ 70).

### Notifications (Settings → Notifications)
Corner popups with a quick look at the player (star, FKDR, WLR, finals, winstreak, sniper score,
blacklist tags) plus short synthesized sounds. You choose per event whether it shows a popup and/or
plays a sound: nick roller match, someone saying your name, DMs, party invites, friend requests,
a **threat joining your lobby** (blacklisted, or sniper score over your threshold; once per player
per lobby), and Name Watch hits. You can pick the corner, duration and volume, and there's a
preview button.

The launch animation has its own synced soundtrack (Settings → Notifications → Startup sound).

**Popups never take focus from your game.** They live in a window that can't be activated or
clicked, is only ever shown inactive, and dismisses itself. The app's launch splash doesn't take
focus either, so starting Solar mid-game won't tab you out.

### Name Watch (Settings → Name Watch)
Your own list of names or patterns, one per line, checked against every player on the overlay.
Plain text matches anywhere in a name, ignoring case (`Cat` matches *xXCatLover*). A regex goes
between slashes (`/^[a-z]{3,4}$/i`). Lines starting with `#` are comments. Matching players get a
purple row, a ✦ next to their name and, optionally, a toast. You can import a `.txt` word list,
and a **Test a name** box shows instantly whether a name hits your list.

### Nick roller (Settings → Nick Roller, `Alt+N`)
Rerolls Hypixel's random nick until one fits your requirements. Type `/nick` → *I understand* →
rank → skin → **Use a random name**, then with that page open and Minecraft focused press `Alt+N`.
The overlay reads each rolled name off the screen, checks it, and clicks **TRY AGAIN** until one
matches. It then stops with the book open, and picking **USE NAME** is your own click.

- **Requirements:** min/max length, no digits, no underscores, plus your own rules (same syntax
  as Name Watch, and you can reuse your Name Watch list). A name must pass every check and match at
  least one rule, if you've written any.
- **Accurate reading:** the name is read by matching every character against the real Minecraft
  font from your own 1.8.9 jar. The font isn't bundled. Generic OCR misreads Minecraft's font
  (M→H, 0→Ø). This matcher works at any GUI scale and refuses to guess: an unclear read stops the run.
- **Safety stops:** it stops when you press `Alt+N` again, click the 🎲 chip, move the mouse,
  switch away from Minecraft, when the book disappears, or when the roll limit is reached. It only
  ever clicks while Minecraft is the focused window.
- **Human-like pacing (all configurable):** a random delay range between rolls (never below
  700 ms), plus optional human-like mouse movement. That's a curved glide with its own speed each
  time, sometimes a small overshoot, and a short pause before clicking, aimed at a random spot on
  TRY AGAIN rather than its exact centre. Hypixel's server never sees your cursor; the glide is only
  what you see on screen.
- **Requirements to run:** Windows, and borderless or windowed mode (exclusive fullscreen can't be
  captured). A Minecraft 1.8.9 jar must be present; it's found automatically in `.minecraft`, or you
  can set the path.

> Automating the nick book is a grey area under Hypixel's rules. Use it at your own discretion.

### Auto-triggers (Settings → Triggers)
Auto-flag players to your local watchlist when they: **say your name in chat**, **join your party**,
**invite you**, **DM you**, or **friend-request you**. All five are **on by default** — the overlay
is meant to work out of the box — but each is an independent toggle if you want it quieter.

### Hide from screen capture
`Settings → Appearance → Hide from screen capture` uses Electron's `setContentProtection`
(→ `WDA_EXCLUDEFROMCAPTURE` on Windows), so the overlay is invisible to OBS, Discord screen-share,
and screenshots while still visible to you. On by default.

### Overlay modes & F11
**Settings → Appearance → When to show the overlay:** *Auto* (lobbies + Bedwars pre-game; hidden in
matches and other games like Duels), *Manual* (Alt+B only) or *Always on*.

**F11 fullscreen fix** (on by default): NVIDIA's OpenGL driver shows a window that exactly fills the
monitor in an exclusive mode that hides every other window. Solar makes Minecraft's F11 window 1px
taller, which keeps it fullscreen-looking but lets Windows draw the overlay and popups on top. It never
takes focus. The cost is at most about one frame of display latency.

### Game performance — no OpenGL errors
The overlay renders on the CPU by default (**Settings → Performance → GPU acceleration**, off).
With Chromium's GPU compositor running, a transparent always-on-top window sits in the same GPU
pipeline as Minecraft's OpenGL surface, which some drivers answer with *OpenGL error 1282
(invalid operation)* in the game. Software rendering keeps the overlay out of that pipeline
entirely. It also avoids GPU-heavy effects (backdrop blurs) and only touches window z-order /
capture-exclusion state when those settings actually change.

### Appearance
Six built-in themes plus full custom colors, window opacity, font size, row height, always-on-top,
click-through, and the row highlight settings above.

---

## Security

- **Keys encrypted at rest.** API keys in `config.json` are sealed with Windows DPAPI (Electron
  `safeStorage`), tied to your Windows account. Only the Settings window ever receives real keys;
  every other window sees a redacted placeholder.
- **Locked-down renderers.** Every window runs sandboxed with context isolation and no Node, behind
  a strict CSP. Pages can't navigate away, open windows, embed webviews, or request browser
  permissions (clipboard write only). IPC only accepts calls from the app's own windows, and every
  argument is validated.
- **Safe outbound traffic.** Links only open `https` URLs on a small allowlist (Plancke, NameMC,
  Hypixel, Urchin, GitHub). Endpoints that carry a key must be `https` (plain `http` is allowed only
  to `localhost`). Every request has a timeout.
- **Hardened binary.** Release builds ship with Electron fuses set: no run-as-Node, no
  `NODE_OPTIONS`/inspector flags, and asar integrity validation.

## Project layout

```
solar-overlay/
├─ package.json
├─ data/blacklist.json         # bundled local blacklist import, keyed by UUID
├─ assets/icon.png
├─ test/                      # unit tests: stats, log parsing, roster, config (npm test)
└─ src/
   ├─ main/
   │  ├─ main.js               # windows, capture-hiding, IPC, triggers, tray, shortcuts
   │  ├─ config.js             # all settings + defaults (persisted to userData/config.json)
   │  ├─ hypixel.js            # Hypixel + Mojang, cache, rate-limit, daily snapshots
   │  ├─ stats.js              # star/FKDR/WLR/monthly + sniper score (pure, tested)
   │  ├─ urchin.js             # Urchin + Connections + local blacklist merge + admin add-tag
   │  ├─ logWatcher.js         # tails the client log, parses chat + party events
   │  ├─ net.js                # request timeouts + https-only endpoint guard
   │  ├─ nameRules.js          # Name Watch / nick rule parsing + matching
   │  ├─ nickRoller.js         # nick roller loop + requirements
   │  ├─ bookReader.js         # reads the rolled name off a screen capture (font matching)
   │  ├─ winHelper.js          # Windows capture/click helper (PowerShell + C#)
   │  ├─ zipReader.js, png.js  # read the font out of the Minecraft jar, no dependencies
   │  ├─ roster.js             # combines everything into the live player list
   │  └─ preload.js            # secure IPC bridge
   └─ renderer/
      ├─ overlay/              # the overlay window
      ├─ settings/             # tabbed settings
      └─ blacklist/            # admin add-tag UI
```

## Contributing / pushing changes

Before committing or pushing, sanity-check that no key is staged:

```bash
git ls-files | grep -i secret                          # should show ONLY secrets.example.js
git grep -nE "key=[0-9a-fA-F]{8}-" $(git rev-parse HEAD) || echo "no embedded keys — good"
```

## Notes
- Keys are stored locally in Electron's `userData/config.json`. Change them anytime in Settings.
- Double-check the Urchin tag shape on your own machine — the parser is defensive and follows the
  documented `{ score:{value,mode}, tags:[…] }` format, but if your instance returns extra fields
  you want shown, they're easy to surface in `urchin.js → _parseTag`.
- To package the Windows installer + portable `.exe`: `npm run dist` (output in `dist/`).
- For development against a throwaway profile (never touches your real config/keys):
  `SOLAR_USER_DATA=./.devprofile npm start` — ignored in packaged builds.
- Log formats vary by client. If detection misses something, paste a sample line and the regexes in
  `logWatcher.js` are straightforward to extend.
