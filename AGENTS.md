# AGENTS.md

Working reference for any agent or contributor touching this repo. Current state only. For how we got here, see [`ARCHITECTURE.md`](./ARCHITECTURE.md). For version history, see [`CHANGELOG.md`](./CHANGELOG.md).

## What this project is

Gamified is a real-time gamification overlay for a weekly video gameshow. Six guests, one host (Sam), one producer (Lemz) running OBS. The project adds a thin static layer on top of the existing VDO.Ninja + OBS setup — it does not replace it.

No backend server. Real-time events ride VDO.Ninja's P2P data channels. Hosted on Cloudflare Pages.

## Repositories

| Repo | Purpose | Branch |
|------|---------|--------|
| `thaneclaw/gamified-hermes-staging` | All development and staging | `staging` |
| `lemz0x/gamified` | Production (manual PR when tested) | `main` |

Staging auto-deploys to `gamified-hermes-staging.pages.dev`. Production deploys to `gamified-2e9.pages.dev`. The staging repo has no `main` branch. The production repo has no `staging` branch. Lemz opens a PR from staging to production after thorough testing.

## Tech stack

- React 18 + Vite 6 + TypeScript
- React Router 6, code-split via `React.lazy`
- Tailwind 4 + inline styles
- Self-hosted fonts: Orbitron 900 (display), Inter (body) at `/public/fonts/`
- VDO.Ninja IFRAME API for P2P data channels
- No backend, no server, no database

## Source files

```
src/
  App.tsx                    # Route definitions, React.lazy code-split
  main.tsx                   # Entry point
  index.css                  # Global styles + all CSS keyframes
  vite-env.d.ts
  cards.ts                   # Card definitions (STFU, WRAP IT UP, MIC DROP)
  emojis.ts                  # Reaction emojis (12), chat emojis (24), EMOJI_COLOURS
  coords.ts                  # Tile coordinates (1920x1080) + SEAT_ORDER
  components/
    BuzzPanel.tsx            # Buzz-in button component
  lib/
    vdoninja.ts              # VDO.Ninja iframe wrapper, event types, payload validation
    vdoninjaChat.ts           # VDO.Ninja chat plumbing (websocket, DOMParser sanitization)
    sfx.ts                   # SFX system (preloaded, cached, cloned per playback)
    auth.ts                  # Producer panel password gate (localStorage)
  routes/
    PlayRoute.tsx            # Guest/host/editor wrapper
    UnderlayRoute.tsx        # OBS browser source, beneath camera layers
    OverlayRoute.tsx         # OBS browser source, top layer (chat-to-screen)
    ProducerRoute.tsx        # Dockable producer panel
    ChatRoute.tsx            # Standalone chat UI (/chat + /editorchat)
```

## Routes

| Route | Purpose |
|-------|---------|
| `/play` | Guest/host/editor wrapper: VDO.Ninja iframe + cards + emoji + chat + buzz + mute |
| `/underlay` | OBS browser source beneath camera layers: emoji floats, card animations, STFU overlays, mute indicators, calibration |
| `/overlay` | OBS browser source above all sources: chat-to-screen, future top-layer graphics |
| `/producer` | Dockable producer panel: roster, buzz board, reset cards, host tracker, activity feed, calibration |
| `/chat` | Standalone chat UI |
| `/editorchat` | Chat-only route for editor |

## Architecture constraints (don't second-guess)

- **No backend server.** Real-time events ride VDO.Ninja's `sendData` API (P2P data channels). Adding a server requires explicit discussion.
- **Wrapper iframes VDO.Ninja, doesn't replace it.** No new peer connections, no video capture, no WebRTC. Guest upload bandwidth is the highest priority constraint.
- **Two-layer OBS architecture.** `/underlay` sits beneath OBS camera layers (emoji floats, card animations, STFU overlays). `/overlay` sits above all OBS sources (chat-to-screen). Both connect to VDO.Ninja independently as data-only codirectors.
- **One underlay browser source, nested as a scene.** Lives in a dedicated `_Overlay` scene added as a nested scene source on top of every other scene. One peer connection, no scene-switch reconnects.
- **Overlay cannot apply CSS filters to camera video.** The overlay/underlay is a separate OBS browser source. `filter: grayscale()` and `mix-blend-mode: saturation` do NOT work across OBS browser sources. All camera effects are painted as overlay divs.
- **Producer's Virtual Camera is what guests see.** Guests view the composited stream, not each other's raw feeds (`roombitrate=0`).

## Hard rules

1. Never add VDO.Ninja peer connections beyond what already exists.
2. Never write text inside the center 44% of the 1920x1080 underlay canvas unless asked.
3. Never use `localStorage` for shared state — per-browser only.
4. Never write to or assume access to a server.
5. Never break the VDO.Ninja chat path.
6. No emoji in code comments or UI text — use the configured set in `src/emojis.ts`.
7. Preserve the user's existing OBS scene structure.
8. No credentials in plain text in docs or source code.

## Build workflow

1. Feature branch from `staging`
2. `npm run build` must pass (tsc + vite)
3. Commit with imperative subject + body explaining the why
4. Push and open PR targeting `staging`
5. Lemz tests on Cloudflare Pages staging URL
6. After approval, Lemz opens PR from `staging` to `lemz0x/gamified` `main` for production

## Cards

Three cards, reset by producer between rounds. STFU (1 use), WRAP IT UP (3 uses), MIC DROP (3 uses) per topic per guest. Playing STFU locks both the STFU and WRAP IT UP buttons for 10s. Playing WRAP IT UP does not start any cooldown. MIC DROP is never affected:

| Card | ID | Color | Effect |
|------|----|-------|--------|
| SHUT THE !@#$ UP | `stfu` | Red #ff2e6b | Mutes all guests except player for 10s. Locks STFU + WRAP IT UP buttons for 10s. SILENCED overlay. |
| WRAP IT UP! | `wrapitup` | Orange #ff7700 | Time's up nudge. Locked when STFU is played, but playing it does not start a cooldown. |
| MIC DROP | `micdrop` | Green #00d96b | Crown the speaker |

## Key systems

**STFU mute:** Dual-flag system (`hostMutedRef` + `stfuMutedRef`) with single circuit-breaker (500ms interval re-asserting `mic: false`). Per-seat mute reasons prevent stacking orphans. SILENCED overlay uses Aria's layered approach (base wash, vignette, pink border ring, label animation). No `mix-blend-mode`.

**STFU sender cooldown:** VDO.Ninja does not echo P2P events back to the sender. Without a local cooldown, the guest who plays STFU could immediately play WRAP IT UP while all other guests were locked. Fix: `startStfuCooldown()` helper is called from both the inbound `onMessage` handler and the local `playCard` function. Cooldown uses absolute expiry time (`cooldownEndsAtRef`) instead of decrementing state, so delayed interval callbacks in OBS CEF can't extend it past 10 real seconds.

**Self-mute tracking:** `selfMutedRef` tracks manual mic mutes via VDO.Ninja's `mic-mute-state` event (both directions). When STFU or host-mute clears, `reconcileMic` checks this ref and does NOT force-unmute a guest who muted themselves.

**Late joiner sync:** Wrappers send `getRoster` on mount (1.5s delay for channel setup). Producer re-broadcasts current roster, host name, and last tracker payload. Mirrors the `getResetEpoch` handshake pattern.

**Host tracker:** Producer types per-seat answers, sends via `trackerUpdate` P2P event. Host display shows 2x3 grid below buzzers. Dark cards (#0e0e16), Orbitron font, gold accent. Committed tracker persists to `localStorage` (`gamified.tracker.v1`) via `saveCommittedTracker()`. On producer mount, state initializes from `loadCommittedTracker()`. `sendTracker` and `clearTracker` both persist. `lastTrackerRef` initializes from localStorage (not null), so a producer refresh still serves the correct tracker to late joiners.

**Effective label sync:** `PlayRoute` maintains `effectiveLabel` state + `effectiveLabelRef`, updated on `rosterUpdate`. Local chat messages, card sender identity, emoji sender identity, header display, and featured chat attribution all use `effectiveLabel` instead of the stale URL parameter `identity.label`. This ensures display names update live when the producer changes roster names mid-show.

**SFX:** Card sounds preloaded, cached, cloned per playback. Source files pre-attenuated at 50%. HTML5 volume 0.4. Cache-busting via `SFX_VERSION` (currently `v7`). Plays on underlay, wrapper, and producer. Clone cleanup on both `ended` and `error` events. DEV-only console logging.

**Buzzer:** Buzz-in panel with 300s auto-off. Producer can clear individual stuck buzzers by clicking the buzzing seat in the buzz board. Crash leaves buzz "on" until manual toggle (producer clear or guest re-toggle).

**Producer panel:** ConfirmButton component replaces `window.confirm()` (which is suppressed in OBS CEF docks). Two-step click with 3s auto-disarm.

**Chat:** Capped at 300 messages per panel (PlayRoute + ChatRoute). Prevents unbounded memory growth during multi-hour shows.

**Emoji floats:** Randomized font size (44-64px), duration (±200ms), and rotation (±10deg) per sprite for visual variety. Sender-side throttle (150ms) prevents data channel flooding from rapid clicking.

**postMessage security:** Origin allow-list for VDO.Ninja domains. Closes the unmounted-iframe gap where any origin could reach callbacks.

**Underlay sweep:** Prunes expired sprites every 250ms. Returns the same array reference when nothing changed to avoid unnecessary React re-renders.

**Producer panel order:** Roster > Buzz board > Reset cards > Host tracker > Activity feed > Calibration.

**Performance:** `React.memo` on all sprites, `React.lazy` per route, single sweep sprite removal (no re-render when idle), self-hosted fonts, static inline styles.

**Payload validation:** Runtime guard on data-channel events. Validates event types, seat IDs, strings, numbers.

**Debug HUD:** `?calibrate=1` shows calibration grid, `?debug=1` shows connection status chip. Both on `/underlay` only.

**Cache headers:** `/*` serves `no-cache` so SPA routes always pick up fresh deploys. `/assets/*` and `/fonts/*` are immutable (content-hashed). `/sfx/*` has 7-day TTL with `SFX_VERSION` query param as cache-buster.

## Design system

| Token | Value |
|-------|-------|
| Background | #0a0a0a |
| Panel BG | #0e0e16 |
| Panel edge | #1f1f30 |
| Text | #f0f0f8 |
| Text dim | #8a8aa3 |
| STFU red | #ff2e6b |
| MIC DROP green | #00d96b |
| Source aura gold | #ffd700 |
| WRAP IT UP orange | #ff7700 |
| Cyan | #22e2ff |
| Purple | #a855ff |
| Pink | #ff2e9f |

Color semantics: cyan = audience/chat, pink = decorative/producer buttons, gold = highlight, red = disruption, green = success, orange = warning. Fonts: Orbitron 900 display, Inter body. Both self-hosted.

## Tile coordinates (1920x1080)

Defaults in `src/coords.ts`. Calibration mode (`?calibrate=1`) allows runtime adjustment, persists via `localStorage`.

```ts
L1: { x: 94,   y: 53,  w: 280, h: 280 }  // top-left
L2: { x: 94,   y: 382, w: 280, h: 280 }  // middle-left
L3: { x: 94,   y: 717, w: 280, h: 280 }  // bottom-left
R1: { x: 1544, y: 53,  w: 280, h: 280 }  // top-right
R2: { x: 1545, y: 385, w: 280, h: 280 }  // middle-right
R3: { x: 1544, y: 719, w: 280, h: 280 }  // bottom-right
```

Center area (~x:540 to x:1380, y:150 to y:640) reserved for producer's topic graphics. Do not render there.

## Communication style

The user (Lemz) is technical but not a software engineer. One-sentence rationales when helpful, no lecturing. Show diffs for meaningful changes. Ask before guessing.
