# CLAUDE.md

You are working on **Gamified** — a podcast overlay system for a weekly video gameshow run on VDO.Ninja + OBS. This file is loaded at the start of every Claude Code session. Read it fully before doing anything else.

## What this project is

A real-time gamification layer for an existing live-to-tape podcast. Six rotating guests debate gaming topics across themed rounds. The producer (Lemz) runs the show through OBS. The host (Sam) moderates. An editor records a backup.

This project does **not** replace the existing OBS + VDO.Ninja setup. It adds a thin layer on top:

1. A **guest wrapper page** (`/play`) that iframes VDO.Ninja and surrounds it with reaction buttons, cards, emoji picker, chat, and buzz-in
2. A **transparent OBS underlay** (`/underlay`) that renders emoji floats, card animations, STFU overlays, host tracker, and calibration grid beneath OBS camera layers
3. A **transparent OBS overlay** (`/overlay`) that renders top-layer graphics above all OBS sources (chat-to-screen feature, future top-layer elements)
4. A **producer panel** (`/producer`) dockable inside OBS for roster, buzz board, card resets, host tracker, activity feed, and calibration

All four are static pages served from Cloudflare Pages. There is no server. Real-time signaling rides VDO.Ninja's existing P2P data channels.

## Repositories and branching

| Repo | Purpose | Branch |
|------|---------|--------|
| `thaneclaw/gamified-hermes-staging` | Staging and all development | `staging` |
| `lemz0x/gamified` | Production (manual PR from staging when tested) | `main` |

**Workflow:**
1. Feature branches off `staging` for development
2. Cloudflare Pages auto-deploys `staging` branch for preview testing
3. After thorough testing, Lemz opens a PR from `staging` to `lemz0x/gamified` `main`
4. PR merge deploys to production at `gamified-2e9.pages.dev`

The staging repo has no `main` branch. The production repo has no `staging` branch. This is intentional.

## Tech stack

- **Frontend framework:** React 18 + Vite 6 + TypeScript
- **Routing:** React Router 6 (code-split via `React.lazy` per route)
- **Styling:** Tailwind 4 + inline styles (no new CSS frameworks)
- **Fonts:** Self-hosted Orbitron 900 (display) and Inter (body) at `/fonts/`. `font-display: optional` prevents mid-animation font swap
- **Real-time transport:** VDO.Ninja IFRAME API (`postMessage` to/from iframe; `sendData` for P2P broadcasts)
- **Chat:** VDO.Ninja's built-in websocket chat via `vdoninjaChat.ts`
- **State:** local component state + `localStorage` for per-guest persistence. No global store
- **Hosting:** Cloudflare Pages, auto-deploy from GitHub. `*.pages.dev` subdomain
- **Icons:** `lucide-react`

## Source files

```
src/
  App.tsx                    # Route definitions, React.lazy code-split
  main.tsx                   # Entry point
  index.css                  # Global styles + all CSS keyframes
  vite-env.d.ts
  cards.ts                   # Card definitions (STFU, WRAP IT UP, MIC DROP)
  emojis.ts                  # Reaction emojis (12), chat emojis (15), EMOJI_COLOURS
  coords.ts                  # Tile coordinates (1920x1080 canvas) + SEAT_ORDER
  components/
    BuzzPanel.tsx            # Buzz-in button component
  lib/
    vdoninja.ts              # VDO.Ninja iframe wrapper, event types, payload validation
    vdoninjaChat.ts          # VDO.Ninja chat plumbing (websocket, DOMParser sanitization)
    sfx.ts                   # SFX system (preloaded, cached, cloned per playback)
    auth.ts                   # Producer panel password gate (localStorage)
  routes/
    PlayRoute.tsx            # Guest/host/editor wrapper
    UnderlayRoute.tsx        # OBS browser source - beneath camera layers
    OverlayRoute.tsx         # OBS browser source - top layer (chat-to-screen)
    ProducerRoute.tsx        # Dockable producer panel
    ChatRoute.tsx            # Standalone chat UI (/chat + /editorchat)
```

## Routes

| Route | Purpose |
|-------|---------|
| `/play` | Guest/host/editor wrapper: VDO.Ninja iframe + cards + emoji + chat + buzz + mute |
| `/underlay` | Transparent OBS browser source beneath camera layers: emoji floats, card animations, STFU overlays, host tracker, calibration |
| `/overlay` | Transparent OBS browser source above all sources: chat-to-screen card, future top-layer elements |
| `/producer` | Dockable producer panel: roster, buzz board, reset cards, host tracker, activity feed, calibration |
| `/chat` | Standalone chat UI for Lemz |
| `/editorchat` | Chat-only route for editor (default label "Phil") |

## Why architecture choices were made (don't second-guess these)

- **No backend server.** Earlier the project used Socket.IO + Fly.io. Removed. Real-time events ride VDO.Ninja's `sendData` API (P2P data channels). Adding a server later requires explicit discussion. Default: stateless.
- **Wrapper iframes VDO.Ninja, doesn't replace it.** Guest cameras publish through VDO.Ninja's infrastructure with existing push IDs and room. The wrapper is chrome around an iframe — no new peer connections, no video capture, no WebRTC. Conserving guest upload bandwidth is the highest priority constraint.
- **Two-layer OBS architecture.** The underlay (`/underlay`) sits beneath OBS camera layers for effects that need to appear "part of the set" (emoji floats, card animations, STFU overlays). The overlay (`/overlay`) sits above all OBS sources for top-layer graphics (chat-to-screen). Both are independent browser sources connecting to VDO.Ninja independently as data-only codirectors.
- **One overlay browser source, nested as a scene.** The underlay lives in a dedicated `_Overlay` scene added as a nested scene source on top of every other scene. One peer connection, one render context, no scene-switch reconnects.
- **Producer's Virtual Camera is what guests see.** Guests do not receive each other's video directly (`roombitrate=0`). They view the producer's composited stream via `view=`. Animations only need to render in the producer's OBS.
- **Overlay cannot apply CSS filters to camera video.** The overlay/underlay is a separate OBS browser source. CSS `filter: grayscale()` and `mix-blend-mode: saturation` do NOT work across OBS browser sources. All camera effects are painted as overlay divs with plain opacity/alpha.

## Hard rules

1. **Never add VDO.Ninja peer connections beyond what already exists.** Each guest publishes once. The wrapper iframes their existing publish URL.
2. **Never write text inside the center 44% of the 1920x1080 underlay canvas** unless explicitly asked — that area is reserved for the producer's existing topic graphics in OBS scenes.
3. **Never use `localStorage` for shared state** — it's per-browser. Use it only for per-guest preferences (card counters, panel collapse state, calibration overrides).
4. **Never write to or assume access to a server.** This is a static site.
5. **Never break the legacy chat path.** The wrapper preserves VDO.Ninja's built-in chat infrastructure. Do not strip iframe chrome that affects chat visibility.
6. **No emoji in code comments or UI text** — emoji are content, rendered via the configured set in `src/emojis.ts`. Do not hardcode emoji elsewhere.
7. **Preserve the user's existing OBS scene structure.** This project adds nested scene sources; it does not modify the existing eight episode scenes' layouts.
8. **No credentials in plain text.** Room passwords and push IDs belong in `.env` or runtime config, not in docs or source code. Reference env var names only.

## Build workflow

1. Create a feature branch from `staging` (`git checkout -b feat/<short-name>`)
2. Implement the change
3. Run `npm run build` — must pass (tsc + vite)
4. Commit with a short imperative subject + body explaining the why
5. Push the branch to origin
6. Open PR targeting `staging` (or merge directly to staging for small changes)
7. Wait for Lemz to test on the Cloudflare Pages staging URL
8. After Lemz approves, he merges staging to `lemz0x/gamified` main via PR for production

## Card system

Three cards, each 1 use per topic per guest, reset by producer between rounds:

| Card | ID | Color | Icon | Description |
|------|----|-------|------|-------------|
| SHUT THE !@#$ UP | `stfu` | Red (#ff2e6b) | zipper-mouth | Cut off the current speaker. Mutes all guests except player for 10s |
| WRAP IT UP! | `wrapitup` | Orange (#ff7700) | alarm clock | Nudge the speaker to finish |
| MIC DROP | `micdrop` | Amber (#ffd700) | microphone | Crown the current speaker |

Cards are defined in `src/cards.ts`. Adding a new card is a new config entry plus its visual treatment in the underlay/overlay routes.

## Key features

### STFU system
- **Dual-flag mute:** `hostMutedRef` + `stfuMutedRef` with single circuit-breaker (500ms interval re-asserting `mic: false` while either flag is true)
- **STFU card:** mutes all guests except the player for 10s. Global 10s lockout prevents retaliation
- **SILENCED overlay:** Aria's layered approach — base wash `rgba(35,35,42,0.72)`, radial vignette, pink accent tint, pulsing pink border ring, SILENCED label with entrance animation. Does NOT use `mix-blend-mode` (doesn't work across OBS browser sources)
- **Per-seat mute reasons:** fixes stacking bug where multiple STFUs could orphan a SILENCED overlay
- Host mute is audio-only (no SILENCED overlay visual)

### Host tracker
- Producer types answers per seat in the producer panel, sends via `trackerUpdate` event on P2P data channel
- Host display shows a 2x3 grid below buzzers with guest names + answers
- Styled with dark cards (#0e0e16), Orbitron font, gold accent label
- Activity feed logs tracker send/clear events

### SFX system
- Card sounds preloaded and cached, cloned per playback for overlap
- Source files pre-attenuated at 50% volume at encode time
- HTML5 volume: 0.4 for all cards
- Cache-busting via `SFX_VERSION` (currently `v7`) — bump when replacing audio files
- Plays on all three surfaces: underlay (OBS recording), wrapper (guests/host), producer panel

### Buzzer system
- Buzz-in panel with auto-off timer (300s / 5 minutes)
- If guest's browser crashes mid-buzz, their buzz stays "on" until manually toggled off

### Producer panel sections (in order)
1. Roster names — editable per-seat, broadcasts to all wrappers
2. Buzz board — buzzer controls
3. Reset cards — clears per-card use counters across all wrappers
4. Host tracker — per-seat text inputs, send to host display
5. Activity feed — last 20 events on the data channel
6. Calibration — tile coordinate editors, toggles `?calibrate=1` on underlay

### Performance optimizations
- `React.memo` on all sprite components (EmojiFloat, StfuCard, MicDropCard, WrapItUpCard, SourceAura, MutedTileOverlay) — prevents unnecessary re-renders in OBS Chromium
- `React.lazy` code-split per route — overlay JS bundle roughly 1/3 of full bundle
- Single sweep interval for sprite removal (replaces multiple `setTimeout` calls)
- Self-hosted fonts (no Google Fonts CDN dependency)
- Static inline style objects (not rebuilt on every render)

### Payload validation
- Runtime guard on inbound data-channel payloads
- Validates event types, seat IDs, emoji strings, card IDs, string lengths, number finiteness
- Rejects malformed payloads silently (no crash)

### Debug HUD
- `?calibrate=1` or `?debug=1` on underlay/overlay shows connection status chip
- Tracks `lastEventAt` for data-channel health monitoring

## Design system (v1.5+)

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

**Color semantics:** cyan = audience/chat, pink = decorative/producer buttons, gold = highlight, red = disruption/punishment, green = success/celebration, orange = warning. Never use pink for communication elements.

**Fonts:** Orbitron 900 for display/card branding, Inter for body text. Both self-hosted at `/fonts/`.

## Tile coordinates (1920x1080 canvas)

Measured from the producer's actual OBS scenes. Defaults in `src/coords.ts`:

```ts
export const TILES = {
  L1: { x: 94,   y: 53,  w: 280, h: 280 }, // top-left
  L2: { x: 94,   y: 382, w: 280, h: 280 }, // middle-left
  L3: { x: 94,   y: 717, w: 280, h: 280 }, // bottom-left
  R1: { x: 1544, y: 53,  w: 280, h: 280 }, // top-right
  R2: { x: 1545, y: 385, w: 280, h: 280 }, // middle-right
  R3: { x: 1544, y: 719, w: 280, h: 280 }, // bottom-right
};
```

Calibration mode (producer panel toggles `?calibrate=1` on underlay) allows runtime adjustment. Values persist via `localStorage` on the underlay browser source's machine.

The center area (~x:540 to x:1380, y:150 to y:640) is reserved for the producer's existing topic graphics. Do not render anything in this region.

## Communication style

The user (Lemz) is technical but not a software engineer. Explain choices with one-sentence rationales when helpful, but don't lecture. Show diffs for meaningful changes. When something is genuinely ambiguous, ask before guessing — the user prefers a brief question over the wrong implementation.
