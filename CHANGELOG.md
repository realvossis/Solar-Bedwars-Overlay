# Changelog

## 1.2.8 — 2026-09-26

### Added
- **Party warning after the game starts.** Pre-game names are scrambled, so after a Bedwars match
  starts Solar waits for your first `/who`, then sends ONE combined party message listing the flagged
  players you weren't already warned about, e.g. `/pc [Solar] Flagged: Sheplock (Blatant Cheater);
  Recoverin (sniper score 88) +1 more` (fitted to the 100-character limit). Once per match; typed only
  when you're not holding any key, and dropped after 20s rather than interrupting a fight. Setting:
  Chat & Dodge -> Also warn after the game starts (on when party warnings are on).

(1.2.7 was replaced by this release; it contains everything from 1.2.7.)

## 1.2.7 — 2026-09-26

### Changed
- Publisher / company / copyright in the app and installer now read **vossis**.

(1.2.6 was replaced by this release; it contains everything from 1.2.6.)

## 1.2.6 — 2026-09-26

### Fixed
- **Every player in the Bedwars pre-game lobby was flagged as nicked.** Hypixel scrambles names in
  pre-game join/quit messages (anti-sniping, e.g. `VK2Gk4HS has joined (4/16)!` - verified in real
  logs), so each random name failed the account lookup. Those messages are now ignored in the pre-game
  lobby: players are added when they talk in chat (chat shows real names) and when the game starts and
  the real player list is revealed.
- **Smarter nick detection.** Besides names with no Minecraft account at all, a real Minecraft account
  that has never played on Hypixel - yet is in your lobby - is now recognised as a nick (that's what
  Hypixel's nick names are). API errors or a missing key never count as a nick. The overlay tooltip
  and the nick popup say why a player was flagged.

(1.2.5 was replaced by this release; it contains everything from 1.2.5.)

## 1.2.5 — 2026-09-26

### Added
- **Chat warnings** (Settings -> Chat & Dodge, Windows):
  - **Warn your party** (off by default): one party-chat message per flagged player, only in the
    Bedwars pre-game lobby, only when you're in a party, capped per lobby.
  - **Public warning (Alt+W)**: types the warning for the next flagged player into chat but does NOT
    send it - you read it and press Enter (or Esc). Repeated presses cycle through the lobby.
  - Messages show the full tag and reason, with your own template ({name} {tag} {reason} {sniper}),
    fitted to Minecraft's 100-character limit (reason shortened with "...", then dropped, then the tag
    shortened). Characters Minecraft kicks you for are removed.
- **Auto-dodge** (off by default): leaves the Bedwars pre-game lobby with your command (/l bedwars by
  default; only plain slash commands accepted) when someone is blacklisted, above an FKDR or sniper
  score limit, or (optionally) nicked. Once per lobby, never after the countdown's last second, never
  for you or your party; a popup says who triggered it.

### Safety
- Solar only types into Minecraft: it must have been the focused window continuously for ~0.6s, focus is
  re-checked before every key, and it stops the moment you tab out. It waits for you to release movement
  keys, modifiers and mouse buttons (max 1.5s, else retries later), so it never fights your input.
  Your chat key is read from Minecraft's options.txt. Your clipboard is only touched for the actual
  paste and restored before anything else can happen.
- Verified against a stand-in Minecraft with a working chat box: nothing typed while tabbed out (into
  the game or the other app), exactly one party message after refocus, Alt+W typed but not sent,
  auto-dodge sent, no stray keys, clipboard preserved; and with W held, nothing is typed until it's released.

(1.2.4 was replaced by this release; it contains everything from 1.2.4.)

## 1.2.4 — 2026-09-26

### Fixed
- **Overlay and notifications invisible in F11 fullscreen (NVIDIA).** The NVIDIA OpenGL driver shows a
  window that exactly fills the monitor in an exclusive mode where Windows draws nothing on top. Solar
  now makes Minecraft's F11 window 1px taller: it still covers the whole screen (taskbar hidden,
  looks identical) but Windows composes it normally, so the overlay and popups show. Never takes
  focus; stops if the game keeps undoing it. Confirmed on a real Lunar F11 session (Windows'
  fullscreen state went from exclusive to normal). Toggle: Settings -> Appearance -> F11 fullscreen fix.
  Cost: FPS essentially unchanged; up to ~1 frame of extra display latency, as with any borderless game.
- **Popups at every Duels start.** Threat and nicked-player alerts are now Bedwars-only by default
  (setting to change), instead of firing for nearly every Duels opponent.

### Added
- **"When to show the overlay"** (Settings -> Appearance): **Auto** - in lobbies and the Bedwars
  pre-game lobby, hidden once a match starts and in other games like Duels from the moment you join;
  **Manual** - only via Alt+B; **Always on**. Alt+B toggles it in every mode; notifications work in all.

(1.2.3 was replaced by this release; it contains everything from 1.2.3.)

## 1.2.3 — 2026-09-26

### Fixed
- **Mentions from players with a lobby star prefix were missed.** Bedwars lobby chat can show the star
  level in guillemets before the rank (`«2188❁» [MVP++] Name: …`), which the chat parser didn't
  accept, so neither the mention alert nor chat tracking saw those lines. Replaying a real log: 18
  more chat lines recognised, including the missed mention.
- Extra alias names typed with dots or spaces ("vossis. voss") are now split into separate aliases
  instead of being silently ignored.
- Mouse paths for the nick roller could end on a rounded duplicate point instead of exactly on the
  target (found by the randomized test).

### Added
- **Alt+T in-game visibility check:** shows a test notification and records how Windows stacks your
  game and Solar's windows (fullscreen state, topmost, stacking order) to `diagnostics.log` in the
  app's data folder, to pin down cases where popups can't be seen over a particular fullscreen setup.
- Open popups are re-raised above a fullscreen game every 250 ms (was 1.5 s).

(1.2.2 was replaced by this release; it contains everything from 1.2.2.)

## 1.2.2 — 2026-09-26

### Added
- **Nicked-player notification**: a popup + sound whenever a nicked player shows up in your lobby
  (once per player per lobby; never for you or your party - add your own nicks under Settings ->
  General -> Extra alias names so you aren't alerted about yourself). Toggle it like any other event.

### Fixed
- **Overlay and notifications hidden in F11 fullscreen.** A borderless-fullscreen game jumps above all
  other always-on-top windows whenever it's activated. The overlay and popups now re-raise
  themselves above it (without ever taking focus). Verified against a topmost fullscreen window
  by reading the real window stacking order.
- A Mojang lookup failure (timeout, rate limit) no longer marks a real player as nicked.

(1.2.1 was replaced by this release; it contains everything from 1.2.1.)

## 1.2.1 — 2026-09-26

### Fixed
- **Click-through could not be turned off again.** Enabling it made the whole overlay ignore the mouse,
  including its own toggle, and the setting persisted across restarts. The title bar now stays
  clickable while click-through is on (the rest of the overlay still passes clicks through to the
  game), so the toggle is always reachable. Verified with a real-mouse test.
- The click-through button could show the wrong state after toggling, and Settings didn't update
  when it was toggled from the overlay.

(1.2.0 was withdrawn because of this bug. 1.2.1 contains everything listed under 1.2.0.)

## 1.2.0 — 2026-09-26

### Added
- **Name Watch**: your own list of plain-text or `/regex/` rules, checked against every player on the
  overlay. Matches get a purple row, a ✦ badge and an optional toast. Includes `.txt` list import,
  live rule validation and a "test a name" box for checking nicks while rolling by hand.

- **Nick roller** (`Alt+N`): with Hypixel's random-name book open, rerolls until the name meets your
  requirements (length, no digits/underscores, your own text or `/regex/` rules, optionally your
  Name Watch list), then stops with the book open for you to click USE NAME. Names are read by
  matching against the real Minecraft font from your local 1.8.9 jar (exact at any GUI scale;
  never guesses). Stops on hotkey, mouse movement, focus loss, missing book or roll limit, and only
  ever clicks while Minecraft is focused. Overlay shows a 🎲 roll counter while running.
- Nick roller pacing: random delay range between rolls, optional human-like mouse movement
  (randomized curved glides with variable speed, occasional overshoot, pre-click pause) and a
  random click point on the link. All configurable, and every roll is re-randomized.

- **Notifications**: corner popups with a player stat summary and synthesized sounds for nick roller
  matches, mentions, DMs, party invites, friend requests, threats joining your lobby and Name Watch
  hits. Per-event popup/sound switches, corner, duration, volume and threat threshold are all
  configurable. The popup window is non-focusable, click-through and only ever shown inactive, so
  it can never pull focus from the game (verified by sampling the foreground window).

### Changed
- UI refresh: one consistent SVG icon set across all windows, a calmer overlay (compact
  locale-independent numbers, right-aligned stats, subtler row states, icon-only Source/Tag
  columns), and card-based Settings with sidebar icons.
- New launch animation (about 6s): a nebula and a spiral galaxy condensing from stardust, its core igniting
  into the Solar sun (flash, shockwave, flare), planets swinging onto their orbits, and a hyperspace-warp
  exit. Drawn on a canvas tuned for CPU rendering (runs at the monitor refresh rate, automatically
  thins particles on slow machines, respects reduced motion). It no longer takes focus when it appears.
- Startup soundtrack synced to the animation (synthesized: ambient swell, ignition boom and bell,
  a pluck per planet, warp whoosh), limited so it never clips. Uses the notification volume; can be
  turned off under Settings → Notifications.
- Repository moved to github.com/realvossis/Solar-Bedwars-Overlay.
- IPC text inputs now accept strings only.

## 1.1.0 — 2026-09-26

### Fixed
- **OpenGL error 1282 in Minecraft while the overlay is open.** The overlay now renders on the CPU by
  default, so it's out of the game's GPU pipeline entirely. GPU-heavy backdrop blurs are gone, and
  topmost/capture-exclusion window state is only re-applied when those settings actually change
  (previously on every config save, e.g. each column sort). GPU acceleration can be turned back on
  under Settings → Performance.
- **Party leader disappearing after you join their party.** "You have joined X's party!" is now
  parsed, and a player's source is upgraded when a stronger signal arrives (invite → party member),
  so they're no longer wiped on the next lobby clear.
- **Party members missing unless you ran `/p list`.** Members are now picked up from party chat,
  summons, promotions, transfers and invites; leaves, kicks and disbands are tracked too. A complete
  `/p list` reconciles the party exactly.
- Mentions no longer trigger on partial words (an IGN like "Ace" matching "race").
- Tooltips no longer get stuck on screen after the list refreshes.

### Removed
- The "final-killed you" marker and trigger. It matched every final kill in the lobby rather than
  only yours, so it mislabelled players (including you). Existing flags it created are cleaned up
  automatically.

### Added
- Title-bar chips showing your party size and the number of threats in the lobby.
- Players who quit the pre-game lobby stay listed but faded.
- NameMC link in the row menu; Blacklist Admin lookups now accept a UUID as well as a name.
- Launching the app a second time focuses the running overlay instead of starting a duplicate.
- Unit tests for log parsing, roster/party logic, and config persistence.

### Security
- API keys are encrypted at rest with Windows DPAPI; non-Settings windows only see redacted keys.
- Renderers are sandboxed; navigation, new windows, webviews and browser permissions are blocked;
  CSP tightened (no remote images).
- IPC only accepts calls from the app's own windows, with argument validation on every handler.
- External links restricted to https on an allowlist; key-carrying endpoints must be https.
- Request timeouts on every network call; config writes are atomic.
- Party/invite/friend patterns are anchored so public chat can't spoof them.
- Release binaries ship with hardened Electron fuses and asar integrity validation.

### Note
Config from 1.0.0 is migrated automatically on first launch. Because keys are then stored encrypted,
going back to 1.0.0 afterwards would require re-entering your API keys.
