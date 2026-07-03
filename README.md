# Gamified

A real-time gamification overlay system for a weekly video gameshow. Six rotating
guests, one host, one producer running OBS. The project adds a thin static layer
on top of the existing VDO.Ninja + OBS setup.

See [`CLAUDE.md`](./CLAUDE.md) for full architecture rules and [`CHANGELOG.md`](./CHANGELOG.md)
for version history.

## What it adds

- **Guest wrapper** (`/play`) — iframes VDO.Ninja, adds reaction buttons, cards,
  emoji picker, chat, and buzz-in
- **OBS underlay** (`/underlay`) — transparent browser source beneath camera
  layers. Renders emoji floats, card animations, STFU silenced overlays, host
  tracker, and calibration grid
- **OBS overlay** (`/overlay`) — transparent browser source above all OBS
  sources. Renders chat-to-screen and future top-layer graphics
- **Producer panel** (`/producer`) — dockable OBS panel for roster, buzz board,
  card resets, host tracker, activity feed, and calibration

No backend server. Real-time events ride VDO.Ninja's existing P2P data channels.
Hosted as a static site on Cloudflare Pages.

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
| `/underlay` | OBS browser source (beneath camera layers): emoji floats, card animations, STFU overlays, host tracker, calibration |
| `/overlay` | OBS browser source (top layer): chat-to-screen card, future top-layer elements |
| `/producer` | Dockable producer panel: roster, buzz board, reset cards, host tracker, activity feed, calibration |
| `/chat` | Standalone chat UI |
| `/editorchat` | Chat-only route for editor (default label "Phil") |

## Cards

Three cards, 1 use per topic per guest, reset by producer between rounds:

| Card | Effect |
|------|--------|
| SHUT THE !@#$ UP (STFU) | Mutes all guests except player for 10s. Global 10s lockout prevents retaliation. SILENCED overlay on muted tiles. |
| WRAP IT UP! | Orange-themed "time's up" nudge |
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
https://gamified-2e9.pages.dev/play?seat=<1-6>&push=<pushID>&label=<GuestName>
```

- `seat=1..6` maps to tiles `L1, L2, L3, R1, R2, R3` (top-left, middle-left,
  bottom-left, top-right, middle-right, bottom-right).
- `push` is the guest's existing VDO.Ninja stream id. The wrapper iframes their
  existing publish URL; it does not create a new peer connection.
- `label` is what shows in the wrapper header and VDO.Ninja chat.

### Host URL

```
https://gamified-2e9.pages.dev/play?role=host&push=<pushID>&label=Host
```

Host wrapper includes `&view=` to receive the producer's composited Virtual
Camera feed. Host is excluded from guest card target pickers.

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

### Producer panel — Custom Browser Dock

In OBS: **View > Docks > Custom Browser Docks**, add a new dock with URL:

```
https://gamified-2e9.pages.dev/producer
```

The panel ships six sections:

1. **Roster names** — set Guest 1-6 names; Save broadcasts to all wrappers
2. **Buzz board** — buzzer controls for each seat
3. **Reset cards** — clears per-card use counters across all wrappers
4. **Host tracker** — per-seat text inputs, send to host display via P2P
5. **Activity feed** — last 20 events on the data channel
6. **Calibration** — enable coordinate editors, adjust X/Y/W/H per tile, broadcasts live to underlay

The dock is also viewable as a regular browser tab.
