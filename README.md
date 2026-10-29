# Gamified

A real-time gamification overlay system for a weekly video gameshow. Six rotating
guests, one host, one producer running OBS. The project adds a thin static layer
on top of the existing VDO.Ninja + OBS setup.

See [`AGENTS.md`](./AGENTS.md) for current architecture rules, [`ARCHITECTURE.md`](./ARCHITECTURE.md)
for historical decisions and failed approaches, and [`CHANGELOG.md`](./CHANGELOG.md)
for version history.

## What it adds

- **Guest wrapper** (`/play`) — iframes VDO.Ninja, adds reaction buttons, cards,
  emoji picker, chat, and buzz-in
- **OBS underlay** (`/underlay`) — transparent browser source beneath camera
  layers. Renders emoji floats, card animations, STFU silenced overlays, mute
  indicators, and calibration grid
- **OBS overlay** (`/overlay`) — transparent browser source above all OBS
  sources. Renders chat-to-screen and Sam's SILENCED wash for STFU-on-Sam
  (it must sit above the Sam Cam source in OBS z-order for the wash to be
  visible)
- **Producer panel** (`/producer`): dockable OBS panel for roster, mute
  controls, buzz board, card resets, STFU on Sam voting, host tracker,
  activity feed, and calibration

No backend server. Real-time events ride VDO.Ninja's existing P2P data channels.
Hosted as a static site on Cloudflare Pages.

Feature highlight: **STFU on Sam**: guests (plus the producer) can
collectively vote to hard-mute the host for 10 seconds. The host wrapper is
the sole vote evaluator and must never see it coming. Full mechanic, wire
protocol, and link rules: [`docs/stfu-on-sam.md`](./docs/stfu-on-sam.md).

## Scripts

```
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build
npm run preview    # serve the production build
npm run typecheck  # tsc only, no bundle
```

## Routes

| Route | Purpose |
|-------|---------|
| `/play` | Guest/host/editor wrapper: VDO.Ninja iframe + cards + emoji + chat + buzz + mute |
| `/underlay` | OBS browser source (beneath camera layers): emoji floats, card animations, STFU overlays, mute indicators, calibration |
| `/overlay` | OBS browser source (top layer): chat-to-screen card, Sam's SILENCED wash (STFU-on-Sam), future top-layer elements |
| `/producer` | Dockable producer panel: roster, mute controls, buzz board, reset cards, STFU on Sam, host tracker, activity feed, calibration |
| `/chat` | Standalone chat UI |
| `/editorchat` | Chat-only route for editor (default label "Phil") |

## Cards

Three cards, reset by producer between rounds. STFU (1 use), WRAP IT UP (3 uses), MIC DROP (3 uses) per topic per guest. Playing STFU locks both the STFU and WRAP IT UP buttons for 10s. Playing WRAP IT UP does not start any cooldown. MIC DROP is never affected:

| Card | Effect |
|------|--------|
| SHUT THE !@#$ UP (STFU) | Mutes all guests except player for 10s. Locks STFU + WRAP IT UP buttons for 10s. SILENCED overlay on muted tiles. |
| WRAP IT UP! | Orange-themed "time's up" nudge. Locked when STFU is played, but playing it does not start a cooldown. |
| MIC DROP | Gold-themed "crown the speaker" celebration |

## Branches and deployment

| Repo | Purpose | Branch |
|------|---------|--------|
| `thaneclaw/gamified-hermes-staging` | All development and staging | `staging` |
| `lemz0x/gamified` | Production | `main` |

- Feature branches auto-deploy preview URLs via Cloudflare Pages
- `staging` branch auto-deploys to `gamified-hermes-staging.pages.dev`
- After testing, Lemz opens a PR from `staging` to `lemz0x/gamified` `main`
- Production deploys to `gamified-2e9.pages.dev`

## Show day setup

Production lives at `https://gamified-2e9.pages.dev`. The producer holds a short
bookmark list for the day: six guest URLs, one host URL, two OBS browser source
URLs (underlay + overlay), one producer dock URL.

### Guest URLs (one per seat)

```
https://gamified-2e9.pages.dev/play?seat=<1-6>&push=<pushID>&label=<GuestName>       (six-guest show)
https://gamified-2e9.pages.dev/play?layout=4&seat=<1-4>&push=<pushID>&label=<GuestName>  (four-guest show)
```

- `seat=1..6` maps to tiles `L1, L2, L3, R1, R2, R3` (top-left, middle-left,
  bottom-left, top-right, middle-right, bottom-right).
- For 4-guest shows, add `layout=4`. `seat=1..4` then maps to `L1, L2, R1, R2`
  (top-left, bottom-left, top-right, bottom-right — the 2×2 OBS scene
  collection "Gamified (4 guests)"). Seat 5/6 links are rejected in this layout.
- `push` is the guest's existing VDO.Ninja stream id. The wrapper iframes their
  existing publish URL; it does not create a new peer connection.
- `label` is what shows in the wrapper header and VDO.Ninja chat.
- Guest cameras publish 1:1 square automatically (`aspectratio=square` + 30fps cap). This saves upload bandwidth since OBS uses square cutouts. No action needed — the wrapper handles it.
- Tile geometry is **design-dependent**: roughly 290px tiles on the 6-guest
  scene and 350px on the 4-guest scene as of Oct 2026, and it varies with the
  overlay design. `src/coords.ts` is the software's source of truth for where
  effects paint; calibrate with `?calibrate=1` (see
  [`docs/url-params.md`](./docs/url-params.md)) to match your OBS scene.
  Hand-built links use the formats above; the producer keeps the day's links
  in the show Google doc; there is no link generator UI anymore.

### Host URL

```
https://gamified-2e9.pages.dev/play?role=host&push=<pushID>&label=Host                     (six-guest show)
https://gamified-2e9.pages.dev/play?role=host&layout=4&push=<pushID>&label=Host            (four-guest show)
```

Host and guest wrappers share the same URL shape — `&broadcast` auto-discovers
the producer's composited Virtual Camera feed. Host is excluded from guest
card target pickers.

**CRITICAL: on a 4-guest show the host link MUST carry `?layout=4`.** The host
wrapper is the sole STFU-on-Sam vote evaluator and derives the vote threshold
from its own URL. A host link without `layout=4` silently runs the 6-guest
universe (3-vote threshold, 6-seat card grid); exactly the Oct 14 show
incident, where the STFU-on-Sam vote never fired. Same rule for all guest
links on a 4-guest show.

### Editor URL

```
https://gamified-2e9.pages.dev/play?role=editor&push=<pushID>&label=Editor
```

Editor publishes audio only (`&videodevice=0`), sees chat-only panel, excluded
from card target pickers.

### OBS browser source — `/underlay`

Add a **Browser Source** in OBS pointing at:

```
https://gamified-2e9.pages.dev/underlay
```

- **Width / Height:** `1920` x `1080`
- **Custom CSS:** leave empty (body background is transparent via `body.overlay-route`)
- **Shutdown source when not visible:** OFF (data-channel iframe must stay mounted)

This lives in a dedicated `_Overlay` scene added as a nested scene source on top
of every other scene. One peer connection, one render context, no scene-switch
reconnects.

For tile calibration during setup, append `?calibrate=1` to the URL.

### OBS browser source — `/overlay` (top layer)

Add a second **Browser Source** in OBS pointing at:

```
https://gamified-2e9.pages.dev/overlay
```

- Place this source at the **top** of the OBS source stack
- Same width/height and shutdown settings as the underlay
- This renders chat-to-screen and any future top-layer graphics
- Since `fa3d560` this source also paints Sam's SILENCED wash for STFU-on-Sam,
  which sits above his camera in every show scene; it MUST stay above the
  Sam Cam source or the wash will be invisible (the underlay's below-camera
  copy is hidden behind his cam)
- Full OBS scene stack guidance: [`docs/obs-scene-setup.md`](./docs/obs-scene-setup.md)

### Producer panel — Custom Browser Dock

In OBS: **View > Docks > Custom Browser Docks**, add a new dock with URL:

```
https://gamified-2e9.pages.dev/producer
```

The panel ships eight sections:

1. **Roster names**: set guest names; Save broadcasts to all wrappers
2. **Mute controls**: mute/unmute individual guests plus mute-all/unmute-all
3. **Buzz board**: buzzer controls for each seat. Click a buzzing seat to clear it (useful when a guest's tab crashes mid-buzz).
4. **Reset cards**: clears per-card use counters across all wrappers
5. **STFU on Sam**: producer's vote button plus live tally (see [`docs/stfu-on-sam.md`](./docs/stfu-on-sam.md))
6. **Host tracker**: per-seat text inputs, send to host display via P2P
7. **Activity feed**: last 20 events on the data channel
8. **Calibration**: enable coordinate editors, adjust X/Y/W/H per tile, broadcasts live to underlay

The dock is also viewable as a regular browser tab.

### Guest ISO recording (optional)

For recording each guest's camera as a separate ISO feed, see
[`docs/obs-source-record-setup.md`](./docs/obs-source-record-setup.md).
Uses the OBS Source Record plugin to capture individual guest streams
before they're composited into the show output.

### VDO.Ninja integration and OBS gotchas

If you're forking this repo or modifying the VDO.Ninja integration, these
docs will save you a lot of trial and error:

- [`docs/vdo-ninja-integration.md`](./docs/vdo-ninja-integration.md) — iframe API, data channels, event types, mute sync architecture, postMessage security
- [`docs/vdo-ninja-quality-params.md`](./docs/vdo-ninja-quality-params.md) — URL parameter research, rationale, OBS encoder settings
- [`docs/obs-cef-gotchas.md`](./docs/obs-cef-gotchas.md) — OBS/CEF quirks: emoji rendering, focus rings, Source Record encoder defaults, audio crackling diagnosis
- [`docs/stfu-on-sam.md`](./docs/stfu-on-sam.md): the STFU-on-Sam guest vote mechanic: wire protocol, thresholds, link rules, open items
- [`docs/obs-scene-setup.md`](./docs/obs-scene-setup.md): OBS scene stack best practices: source order, layout collections, deploy repointing
- [`docs/url-params.md`](./docs/url-params.md): canonical reference for every Gamified URL parameter and which routes read them
- [`docs/forking.md`](./docs/forking.md): credential rotation checklist and threat model for anyone forking this repo

### Forking this repo

Before sharing or deploying a fork, you MUST rotate the room credentials
and producer password baked into the client bundle; see
[`docs/forking.md`](./docs/forking.md).

## Running it locally (onboarding notes)

- **Minimum test rig:** two browser tabs plus a throwaway vdo.ninja room.
  Open `/play?seat=1&push=<testStreamID>&label=Test` in one tab and the
  `/producer` panel in the other; events flow over the room's data channels.
  Substitute your own push IDs; the bundled ones belong to the live show.
- **The missing-params help screen is expected behavior.** `/play` without
  `seat`/`push`/`label` (or with an out-of-range seat like 5/6 on a
  `layout=4` show) renders a "Missing URL params" help screen, not a broken
  build.
- **No tests or CI exist.** Verification is `npm run build` (tsc + vite) plus
  manual testing on the staging deploy.
- **npm >= 9** (lockfileVersion 3). No `engines` pin in package.json; any
  modern Node toolchain works.
