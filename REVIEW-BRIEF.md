# Adversarial Code Review Brief — Gamified

**Reviewer:** GPT 5.6
**Date:** 2026-07-15
**Reviewer role:** Adversarial code auditor. Find bugs, race conditions, performance issues, security holes, and optimization opportunities. Challenge assumptions. But respect the architectural constraints listed below — they are hard-won decisions from production failures, not laziness.

---

## What This Project Is

Gamified is a real-time gamification overlay for a weekly live video gameshow. Six guests, one host (Sam), one producer (Lemz) running OBS. The show is recorded live every week.

The project is a **thin static layer on top of an existing VDO.Ninja + OBS setup**. It does NOT replace the show infrastructure. It adds:

- A guest wrapper page (`/play`) that iframes VDO.Ninja and adds gameplay UI (cards, emojis, chat, buzzers, tracker)
- An OBS underlay browser source (`/underlay`) that renders animations beneath camera layers
- An OBS overlay browser source (`/overlay`) that renders chat-to-screen and future top-layer graphics above all sources
- A producer panel (`/producer`) docked in OBS for controlling the show
- Standalone chat routes (`/chat`, `/editorchat`)

**No backend server. No database. No API.** Real-time events ride VDO.Ninja's existing P2P data channels via the iframe `postMessage` API. Hosted as a static site on Cloudflare Pages.

---

## Tech Stack

- React 18 + Vite 6 + TypeScript (strict mode)
- React Router 6 with `React.lazy` code-splitting per route
- Tailwind 4 (preflight only — minimal utility usage, most styling is inline)
- Self-hosted fonts: Orbitron 900 (display), Inter (body) at `/public/fonts/`
- VDO.Ninja IFRAME API for P2P data channels
- No backend, no server, no database, no WebSocket of our own

**Bundle:** ~54 KB gzipped main chunk, route-specific chunks 1-9 KB each.

---

## Repositories and Deployment

| Repo | Purpose | Branch |
|------|---------|--------|
| `thaneclaw/gamified-hermes-staging` | All development and staging | `staging` |
| `lemz0x/gamified` | Production (manual PR when tested) | `main` |

- Staging auto-deploys to `gamified-hermes-staging.pages.dev`
- Production deploys to `gamified-2e9.pages.dev`
- Lemz opens a PR from staging to production after thorough testing
- The staging repo has no `main` branch; the production repo has no `staging` branch

---

## File Map (7,184 lines of source)

```
src/
  App.tsx                    (54 lines)   Route definitions, React.lazy code-split
  main.tsx                   (15 lines)    Entry point
  index.css                  (~350 lines)  Global styles + CSS keyframes
  vite-env.d.ts              (1 line)      Vite type shim
  cards.ts                   (65 lines)    Card definitions (STFU, WRAP IT UP, MIC DROP)
  emojis.ts                  (78 lines)    12 reaction emojis, 24 chat emojis, EMOJI_COLOURS
  coords.ts                  (109 lines)   Tile coordinates (1920x1080), SEAT_ORDER, calibration
  components/
    BuzzPanel.tsx            (164 lines)   Buzz-in button component + useBuzzState hook
  lib/
    vdoninja.ts              (579 lines)   VDO.Ninja iframe wrapper, event types, payload validation
    vdoninjaChat.ts           (301 lines)   VDO.Ninja chat plumbing (websocket, DOMParser sanitization)
    sfx.ts                   (86 lines)    SFX system (preloaded, cached, cloned per playback)
    auth.ts                  (61 lines)    Producer panel password gate (localStorage)
    sanitize.ts              (9 lines)     Strip control chars + zero-width + collapse whitespace
    emojiAliases.ts           (182 lines)   Colon-triggered emoji autocomplete for chat
  routes/
    PlayRoute.tsx            (2051 lines)  Guest/host/editor wrapper: VDO.Ninja iframe + cards + emoji + chat + buzz + mute + tracker
    UnderlayRoute.tsx        (1229 lines)  OBS browser source beneath camera layers: emoji floats, card animations, STFU overlays, mute indicators, calibration
    OverlayRoute.tsx         (268 lines)   OBS browser source above all sources: chat-to-screen card
    ProducerRoute.tsx        (1149 lines)  Dockable producer panel: roster, buzz board, reset cards, host tracker, activity feed, calibration
    ChatRoute.tsx             (783 lines)   Standalone chat UI (/chat + /editorchat) with tracker bar
```

---

## Routes

| Route | Purpose |
|-------|---------|
| `/play` | Guest/host/editor wrapper: VDO.Ninja iframe + cards + emoji + chat + buzz + mute + tracker |
| `/underlay` | OBS browser source beneath camera layers: emoji floats, card animations, STFU overlays, mute indicators, calibration |
| `/overlay` | OBS browser source above all sources: chat-to-screen card, future top-layer elements |
| `/producer` | Dockable producer panel: roster, buzz board, reset cards, host tracker, activity feed, calibration |
| `/chat` | Standalone chat UI (default label "Lemz") |
| `/editorchat` | Chat-only route for editor (default label "Phil") |

---

## Architecture Constraints (DO NOT SUGGEST CHANGING THESE)

These are hard constraints from production failures, not laziness:

1. **No backend server.** Real-time events ride VDO.Ninja's `sendData` API (P2P data channels). Adding a server requires explicit discussion with Lemz.

2. **Wrapper iframes VDO.Ninja, doesn't replace it.** No new peer connections, no video capture, no WebRTC. Guest upload bandwidth is the highest priority constraint.

3. **Two-layer OBS architecture.** `/underlay` sits beneath OBS camera layers (emoji floats, card animations, STFU overlays). `/overlay` sits above all OBS sources (chat-to-screen). Both connect to VDO.Ninja independently as data-only codirectors.

4. **Overlay cannot apply CSS filters to camera video.** The overlay/underlay is a separate OBS browser source. `filter: grayscale()` and `mix-blend-mode: saturation` do NOT work across OBS browser sources. All camera effects are painted as overlay divs.

5. **One underlay browser source, nested as a scene.** Lives in a dedicated `_Overlay` scene added as a nested scene source on top of every other scene. One peer connection, no scene-switch reconnects.

6. **Producer's Virtual Camera is what guests see.** Guests view the composited stream, not each other's raw feeds (`roombitrate=0`).

7. **No `localStorage` for shared state.** Per-browser only. Each OBS browser source has its own localStorage.

8. **Never break the VDO.Ninja chat path.** Chat uses VDO.Ninja's built-in websocket chat, not our P2P data channel.

9. **Never animate layout properties** (top, left, width, height). Only transforms, opacity, filter, box-shadow. This is for OBS CEF performance.

10. **Producer password is intentionally client-side.** Not a security model. Deters casual visitors. Do not suggest moving to a real auth backend.

11. **Data channel topology: dataonly codirector.** The producer joins as a "dataonly codirector" for bidirectional data flow. Previous topologies (dataonly without codirector, novideo+noaudio+push) all failed. Do NOT suggest reverting.

12. **reconcileMicRef pattern.** The mic reconciliation function is a ref, not a useCallback, because the VDO.Ninja message listener captures it and useCallback caused stale closure bugs. Do NOT suggest converting back to useCallback.

13. **Circuit breaker re-asserts `mic: false` every 500ms during STFU.** This is intentional. VDO.Ninja guests can unmute themselves by clicking their mic. The circuit breaker re-asserts the STFU mute. Host mutes are advisory (no circuit breaker) — guests CAN unmute themselves during a host mute.

14. **Mobile guest support is explicitly "never".** Desktop only.

---

## Key Systems

### Cards

Three cards, reset by producer between rounds (topics):

| Card | ID | Uses/Topic | Effect |
|------|----|-----------|--------|
| SHUT THE !@#$ UP | `stfu` | 1 | Mutes all guests except player for 10s. Locks STFU + WRAP IT UP buttons for 10s. SILENCED overlay on muted tiles. |
| WRAP IT UP! | `wrapitup` | 3 | Time's up nudge. Locked when STFU is played, but playing it does NOT start a cooldown. |
| MIC DROP | `micdrop` | 3 | Crown the speaker. Never affected by cooldown. |

### STFU Mute System (dual-flag)

The most complex and bug-prone system. Two refs track mute state:
- `hostMutedRef` — host muted this guest (advisory, guest can self-unmute)
- `stfuMutedRef` — STFU card muted this guest (hard lock, circuit breaker re-asserts)

A `selfMutedRef` tracks when a guest manually muted themselves via VDO.Ninja's mic button, so the reconcileMic function doesn't force-unmute them when STFU or host-mute clears.

The circuit breaker (`setInterval` 500ms) only runs while STFU is active. It re-asserts `mic: false` to the VDO.Ninja iframe. When STFU clears, it actively sends `mic: true` to unmute — unless the guest self-muted.

**Recent bug fixed:** STFU auto-unmute. After STFU expired, nothing was sending `mic: true` back. Guests stayed muted. Fixed by adding active unmute in `reconcileMic` when STFU clears and guest is not self-muted.

### SILENCED Overlay (underlay side)

Per-seat mute reasons system: `Map<SeatId, Set<MuteReason>>` where MuteReason = "host" | "stfu" | "muteall". A seat shows SILENCED while any "stfu" or "muteall" reason remains. Individual host mutes do NOT show SILENCED (audio-only).

Key interactions:
- `guestSelfUnmuted` clears "host" and "muteall" but never "stfu"
- Individual unmute after mute-all clears BOTH "host" and "muteall" (prevents stale SILENCED)
- STFU timeout only removes "stfu" reasons (preserves "host" reasons)

### Late Joiner Sync

When a wrapper mounts, it sends `getRoster` (1.5s delay for channel setup). The producer re-broadcasts:
- Current roster names + host name
- Last tracker payload (title + answers)
- Latest card reset epoch

This pattern is used by PlayRoute, UnderlayRoute, and ChatRoute.

### Chat Infrastructure

Two separate communication channels:
1. **P2P data channel** (`sendData` via VDO.Ninja iframe): gameplay events (emoji, cards, mute, buzz, tracker, roster, calibration)
2. **VDO.Ninja built-in chat** (websocket via iframe): chat messages between participants

Chat messages arrive as HTML fragments (`<b><span class='chat_name'>NAME</span>:</b> message`). The `parseChatBody` function uses DOMParser to extract label + plain-text body. Never feed raw HTML into React.

### Host Tracker

Producer types per-seat answers and sends via `trackerUpdate` P2P event. All surfaces (PlayRoute, ChatRoute) display a 2x3 grid of guest names + answers. When the tracker is empty (cleared or initial state), the section shows "PANELIST ANSWERS - WAITING" header with "Waiting..." placeholder in each slot. The tracker section is ALWAYS visible.

### Emoji System

- 12 reaction emojis (2 rows of 6) in `/play`
- Per-emoji brand colors for hover glow
- Sender-side throttle (150ms) prevents data channel flooding
- Per-seat soft cap (30 simultaneous floats) prevents DOM explosion
- Randomized font size, duration, rotation per sprite for visual variety
- Single sweep interval (250ms) prunes expired sprites across all three arrays in one render

### Buzzer

- 300s auto-off timer (prevents forgotten buzzers)
- Producer can clear individual stuck buzzers
- Crash leaves buzz "on" until manual toggle

### Payload Validation

`validatePayload` in vdoninja.ts narrows unknown inbound data to valid `EventPayload`. Rejects malformed payloads so downstream switch statements never crash on undefined access. Validates:
- Event types against a set
- Seat IDs against `SEAT_ORDER`
- Card IDs against valid set
- Emoji strings against `EMOJIS` set
- Sender fields (`from`) on emoji and cardPlay events
- String length limits on chat-to-screen author (64 chars max)

### Chat-to-Screen

Producer or host can "feature" a chat message, pushing it to the top-layer overlay (`/overlay`) as a styled on-screen card with:
- Neon glow ring (masked border strip, animated background-position)
- Dual-layer focus backdrop (ambient feather + tight pill for text readability)
- Gamified logo + author name (Orbitron) + message text
- 15s auto-dismiss with CSS animation
- Grapheme-aware truncation (200 grapheme cap)

### postMessage Security

- Origin allow-list for VDO.Ninja domains in chat handler
- Mic-mute-state event listener checks origin (`vdo.ninja` / `www.vdo.ninja`)
- All P2P payloads are namespaced under `overlayNinja` key

---

## Recent Changes (last 4 commits on staging, not yet on production)

### 1. STFU Auto-Unmute Fix
- Added active unmute (`mic: true`) when STFU clears and guest is not self-muted
- Added `selfMutedRef` to track guest's manual mic state
- Origin check on mic-mute-state events from VDO.Ninja

### 2. SILENCED Overlay Bookkeeping
- Individual unmute after mute-all now clears both "host" and "muteall" reasons
- `guestSelfUnmuted` event clears "host" and "muteall" but never "stfu"

### 3. STFU + WRAP IT UP Cooldown
- STFU locks both STFU and WRAP IT UP for 10s (was STFU-only before)
- WRAP IT UP does not trigger any cooldown
- MIC DROP is never affected

### 4. Tracker Always Visible + Chat Scroll Fix (today's commit)
- Tracker section always renders on `/play` and `/chat`, never hides
- Empty title shows "WAITING" header, empty answers show "Waiting..."
- ChatRoute now listens for `rosterUpdate` + `trackerUpdate` events
- ChatRoute sends `getRoster` on mount for late joiner sync
- ProducerRoute: `lastTrackerRef` initialized to empty (not null) so first late joiner always gets tracker
- ProducerRoute: `clearTracker` stores empty state (not null)
- ProducerRoute: `getRoster` handler always re-broadcasts tracker
- Removed "smart auto-scroll" (nearBottom check) from both PlayRoute ChatPanel and ChatRoute ChatFeed
- Always scroll to bottom on new message for all users

---

## Known Issues and Failed Approaches

### Card reset propagation (SOLVED but fragile)
Multiple failed topologies before the current "dataonly codirector" approach:
- `localStorage` epoch comparison — events never reached the wrapper
- Ref-pinned `onMessage` listener — synthetic verification masked the bug
- `&novideo&noaudio&push` — partial connection, not bidirectional
- Current: `dataonly codirector` — bidirectional, works

### STFU color iterations (SOLVED)
- v1.2: near-black dim wash (read as "tile turned off")
- Bright red tinted overlay (too subtle)
- `mix-blend-mode: saturation` — doesn't work across OBS browser sources (solid box)
- Current: Aria's layered approach — base wash + radial vignette + pink tint + pulsing border + SILENCED label

### Chat HTML parsing (SOLVED)
VDO.Ninja sends chat as HTML fragments. Multiple parser attempts failed on real messages. Current: DOMParser-based extraction of `.chat_name` span, strip all tags from body, handle multiple VDO.Ninja message shapes (incoming-chat action, gotChat field, top-level chat field).

### reconcileMic stale closure (SOLVED)
`useCallback` version was called inside `onMessage` but wasn't in its dependency array, causing stale closure. Fixed by changing to `reconcileMicRef` — ref-based, zero deps.

---

## Review Scope

### What to look for:

1. **Race conditions in mute system.** The STFU/host-mute/self-mute interaction is complex. Look for:
   - Timing gaps between STFU expiry and circuit breaker shutdown
   - Race between `guestSelfUnmuted` and STFU circuit breaker
   - Stale closure issues in any ref-based callbacks
   - State updates that might batch incorrectly

2. **P2P data channel reliability.** Events are fire-and-forget over P2P. Look for:
   - Missing late-joiner sync (any state that should be re-broadcast on `getRoster` but isn't)
   - State that can diverge between peers if an event is dropped
   - Event ordering assumptions (timestamps used for idempotency, not ordering)

3. **Performance in OBS Chromium.** The overlay runs in OBS's embedded Chromium (CEF). Look for:
   - Unnecessary re-renders (missing `React.memo`, inline object creation in render)
   - Layout thrashing (animating non-transform properties)
   - Memory leaks (timers, event listeners not cleaned up)
   - Excessive DOM node creation (sprite systems)

4. **Security.** Look for:
   - XSS vectors in chat rendering (DOMParser output, feature message rendering)
   - postMessage origin validation gaps
   - Payload validation bypass paths

5. **State management bugs.** Look for:
   - Stale closures in event handlers
   - Missing dependency arrays in useCallback/useEffect
   - Ref mutations that bypass React's render cycle
   - localStorage race conditions across browser sources

6. **Edge cases.** Look for:
   - What happens when producer disconnects mid-show?
   - What happens when a guest refreshes during STFU?
   - What happens when two STFUs are played back-to-back?
   - What happens when the underlay browser source refreshes mid-card-animation?
   - What happens to chat messages if VDO.Ninja chat websocket drops?

7. **Code quality and optimizations.** Look for:
   - Dead code, unused imports, unused exports
   - Duplicate logic across routes (roster loading, label sync, etc.)
   - Inline style objects recreated every render (should be hoisted or memoized)
   - Overly large components that should be split
   - Missing error boundaries
   - Accessibility issues

### What NOT to flag:

- The architectural constraints listed above (no backend, VDO.Ninja iframe, OBS CEF limitations, etc.)
- The producer password being client-side (intentional)
- The dual-iframe architecture (underlay + overlay as separate browser sources)
- The `reconcileMicRef` pattern (ref, not useCallback — intentional)
- The circuit breaker 500ms interval (intentional)
- Mobile support being absent (intentional — desktop only)
- The `react-router-dom` dependency (can't drop without rewriting all routes; known tech debt, not a bug)
- Inline styles over CSS modules/Tailwind (intentional for OBS CEF compatibility and code-split simplicity)

### Output format:

For each finding, provide:
1. **Severity:** Critical / High / Medium / Low / Info
2. **File + line number(s)**
3. **Description:** What's wrong
4. **Impact:** What could go wrong in production during a live show
5. **Suggested fix:** How to fix it (code snippet if useful)
6. **Confidence:** Are you sure this is a real bug, or is it a possible issue that needs verification?

Group findings by severity. Lead with the most critical issues. Be adversarial but precise — false positives waste time. If you're not sure about something, mark it as "needs verification" rather than asserting it's a bug.
