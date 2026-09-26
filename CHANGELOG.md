# Changelog

## Unreleased

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

### Changed
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
