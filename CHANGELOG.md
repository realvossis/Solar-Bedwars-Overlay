# Changelog

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
