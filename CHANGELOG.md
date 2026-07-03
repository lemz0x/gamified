# Changelog

All notable changes to Gamified are documented here. Versions follow the show's internal versioning, not semver.

---

## [Unreleased] — feat/chat-to-screen branch

### Added
- **Two-layer OBS architecture:** overlay system split into `/underlay` (beneath camera layers) and `/overlay` (top-layer, above all sources)
- **Chat-to-screen feature (in progress):** producer can select chat messages and push them to the top-layer overlay as styled on-screen text graphics with neon glow ring and Gamified branding
- New `OverlayRoute.tsx` for top-layer overlay (chat-to-screen card)
- New `UnderlayRoute.tsx` (renamed from old `OverlayRoute.tsx`)
- Two-iframe architecture on producer panel: existing data-only codirector iframe + new chat-only iframe for VDO.Ninja chat reception
- `ChatToScreenEvent` and `ChatToScreenClearEvent` on P2P data channel
- Full v3 implementation plan (704 lines, 3 subagent audit passes, Aria design locked)
- Underlay/overlay route split in `App.tsx` with `React.lazy`

### Changed
- `/overlay` route now points to the NEW top-layer overlay, not the original underlay
- Existing OBS browser source should be renamed from `/overlay` to `/underlay`
- New OBS browser source pointing to `/overlay` should be added at top of source stack

---

## [v1.5] — 2026-06-30

### Added
- **Card play glow rework:** `SourceAura` changed from inset shadow to outset glow with gold border ring, higher opacity (0.95/0.70/0.45/0.25), 3s duration
- **STFU silenced effect (Aria v2 spec):** rebuilt with layered approach — base wash `rgba(35,35,42,0.72)`, radial vignette, pink accent tint `rgba(255,46,107,0.12)`, pulsing pink border ring (`silencedRingPulse` keyframe), SILENCED label with entrance animation
- **Host tracker:** producer can type answers per seat and send to host display via `trackerUpdate` event. Host sees a 2x3 grid below buzzers with guest names + answers, styled with dark cards (#0e0e16) and Orbitron font
- **Producer panel reorder:** roster > buzz board > reset cards > host tracker > activity feed > calibration
- **Buzzer timer:** increased from 120s to 300s (5 minutes)
- Activity feed logs tracker send/clear events
- Uppercase answers on host display

### Changed
- STFU overlay color revised through multiple iterations — from flat gray to Aria's radial gray wash (`rgba(100,100,108,0.55)` center fading to `rgba(45,45,52,0.92)` edges)
- Host mute uses audio-only muting (no SILENCED overlay visual, since host mic is independent of the STFU card system)
- Card box styling: `overflow:hidden` + `borderRadius` on `cardBoxStyle`
- Dim wash: `rgba(20,18,25,0.55)` for subtle background dim

### Fixed
- STFU overlay no longer uses `mix-blend-mode: saturation` (doesn't work across OBS browser sources)
- SILENCED overlay correctly clips to rounded camera corners
- Host mute no longer triggers visual SILENCED overlay (only STFU card does)

---

## [v1.4] — 2026-06-10

### Added
- **Source Aura:** gold inset glow ring on the card player's tile (not the target) via `SourceAuraSprite` component. 3s duration (300ms fade in, 2.4s hold, 300ms fade out). `sourceAuraGlow` CSS keyframe
- **Muted Tile Overlay:** SILENCED label + desaturation wash on muted guest tiles. Tracks `mutedSeats` state from `muteGuest`/`unmuteGuest` events. `MutedTileOverlay` component with `silencedLabelIn` CSS keyframe
- **STFU cooldown timer:** global 10s lockout after any STFU is played. Countdown displayed on card button with `cooldownPulse` border animation. Prevents retaliation
- **WRAP IT UP card:** third card added (orange #ff7700). Time's up / nudge speaker. `CardColor` type extended with `"orange"`
- **SFX system:** card sound effects for STFU, MIC DROP, WRAP IT UP. Preloaded and cached, cloned per playback for overlap. `sfx.ts` library
- **Buzz-in panel:** `BuzzPanel` component, buzzer auto-off timer

### Changed
- Buzzer auto-off: 30s to 120s
- STFU mute duration: 5s to 10s
- SFX volume: stfu 0.4, micdrop 0.4, wrapitup 0.4 (source files pre-attenuated at 50% at encode time)
- Card center-screen announce: 3s to 6s (camera animations stay at 2.5s)
- WRAP IT UP color: yellow (#ffcc00) to orange (#ff7700) to avoid clashing with gold source aura
- STFU card alarm volume reduced to 40%

### Fixed
- STFU stacking orphan overlay bug: per-seat mute reasons system prevents orphaned SILENCED overlays when STFU is stacked
- `reconcileMic` stale closure: changed from `useCallback` to `reconcileMicRef`
- Over-engineered circuit-breakers: consolidated into single interval checking `hostMutedRef || stfuMutedRef`
- `muteCooldownDone` retained as no-op handler for backward compatibility

---

## [Phase 1-5 Hardening] — 2026-06-03

### Added
- **Per-seat mute reasons:** dual-flag system (`hostMutedRef` + `stfuMutedRef`) with single circuit-breaker. Fixes STFU stacking permanently silencing a guest
- **React.memo on all sprite components:** `EmojiFloat`, `StfuCard`, `MicDropCard`, `WrapItUpCard`, `SourceAura`, `MutedTileOverlay` — prevents unnecessary re-renders in OBS Chromium
- **Single sweep removal:** unified cleanup effect replaces multiple `setTimeout` calls for sprite removal
- **Self-hosted fonts:** Orbitron 900 and Inter self-hosted at `/fonts/` instead of Google Fonts CDN. `font-display: optional` prevents mid-animation font swap
- **Code-split routes:** `React.lazy` per route. Overlay JS bundle reduced to roughly 1/3 size
- **Payload validation:** runtime guard on inbound data-channel payloads. Validates event types, seat IDs, emoji strings, card IDs, string lengths, number finiteness
- **Debug HUD:** `?calibrate=1` or `?debug=1` shows connection status chip on overlay
- **Data-channel health:** `lastEventAt` tracking, connection-status rendering in debug mode

### Changed
- DRY: `EMOJI_COLOURS` extracted to shared module in `emojis.ts` (was duplicated in PlayRoute + OverlayRoute)
- DRY: `SEAT_ORDER` deduplicated into `coords.ts`
- DRY: `buildIframeUrl` and `buildHostIframeUrl` were byte-identical — deduped in Phase 5.3
- Multiple `setTimeout` for sprite removal replaced by single sweep interval

### Fixed
- `reconcileMicRef` stale closure: ref-based approach avoids `useCallback` dependency churn
- Circuit-breaker race condition: single interval checking both flags eliminates race
- Host mute visual override by STFU expiry: dual-flag system means host mute persists independently

---

## [v1.2-staging] — 2026-05-27

### Added
- STFU dim wash changed from near-black to bright red (`rgba(220,0,40,0.55)`)
- Chat logging pipeline added to `vdoninjaChat.ts` to diagnose HTML parsing issues

### Fixed
- **Chat HTML bleed RESOLVED:** parser now handles all VDO.Ninja message shapes. Raw HTML no longer renders in chat panel
- Animation sizing on rounded camera windows: overlays now render correctly against inner cam shape

---

## [v1.2] — 2026-05-22 (PRs #16-22)

### Added
- **Guest layout fix:** added `&broadcast` to guest iframe URL — fixes layout breaking when multiple guests join
- **Animation polish v2:** MIC DROP green theme (#00d96b) + falling mic animation, STFU intensity boost
- **Producer auth:** `localStorage` password gate on `/producer` route. `gamified.auth.v1` key. OBS Custom Browser Docks retain auth across restarts
- **Editor role:** `?role=editor` variant — audio-only publish via `&videodevice=0`, chat-only panel, excluded from card target pickers
- **Host + editor single-URL pattern:** director/codirector privileges baked into one URL

### Fixed
- **Card reset bug RESOLVED (PR #26):** producer joins overlay context as "dataonly codirector" for bidirectional data flow. Cards now propagate per-guest correctly across tabs. Previous attempts (localStorage epoch, ref-pinned listener, `&novideo&noaudio&push`) all failed

### Changed
- Chat HTML parsing: DOMParser-based sanitizer for VDO.Ninja's `<b><span>` message format

---

## [v1.1] — 2026-05-06 (PRs #11-15)

### Added
- Animation polish v1: `slamIn` keyframes, mic fall animation
- Header rework: GAMIFIED wordmark moved to top center between guest label and LIVE indicator
- Producer panel section reorder: roster, calibration, reset, activity
- Chat extraction in wrapper: input + emoji picker + send button

### Fixed
- Card reset bug: epoch comparison attempt (did not solve the bug)

---

## [v1.0] — 2026-05-04 (Phases 1-7)

### Added
- **Phase 1:** Repo cleanup — legacy Socket.IO server removed, unused routes deleted (LoginRoute, ProducerRoute, HostRoute, OverlayRoute, ContestantRoute)
- **Phase 2:** Config files — `src/coords.ts` (tile coordinates), `src/emojis.ts` (12 reaction emojis + 15 chat emojis), `src/cards.ts` (STFU + MIC DROP)
- **Phase 3:** VDO.Ninja iframe wrapper library — `src/lib/vdoninja.ts` (postMessage API, sendData broadcasting, event type system)
- **Phase 4:** `/play` wrapper route — VDO.Ninja iframe + emoji panel + card panel + target picker modal
- **Phase 5:** `/overlay` route — transparent OBS browser source, emoji float animation, STFU + MIC DROP card animations
- **Phase 6:** `/producer` route — roster names, reset cards, activity feed, calibration mode
- **Phase 7:** Deployment polish — `_redirects`, `_headers`, Cloudflare Pages setup, show-day documentation
- VDO.Ninja chat library: `src/lib/vdoninjaChat.ts` (websocket-based chat, DOMParser sanitization)
- Auth library: `src/lib/auth.ts`
- SFX library: `src/lib/sfx.ts`

### Architecture
- Static site on Cloudflare Pages, no backend server
- Real-time via VDO.Ninja P2P data channels (`sendData` API)
- Three surfaces: guest wrapper, OBS overlay, producer panel
- 1920x1080 canvas, tile coordinates measured from actual OBS scenes
