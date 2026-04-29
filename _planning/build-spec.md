# Gamified — Build Spec

This is the source-of-truth document for what's being built and why. Captured from a multi-session brainstorm between the producer and Claude. Keep this updated as decisions evolve.

---

## 1. Context

**The show:** Gamified, weekly video podcast. Host + Producer + Editor + 6 rotating guests. Live-to-tape, gameshow-structured: guests debate gaming topics across themed rounds.

**Current production stack (do not change):**
- VDO.Ninja for video pipes — room `GamifiedShow`, password `gaming`
- OBS for compositing — 1920×1080 @ 30fps, 8 themed scenes
- Producer outputs OBS Virtual Camera as `push=TBSqrdw`; all guests view that composited stream rather than each other's raw feeds
- Editor records a backup locally with the same OBS scene template

**The collaborator's prototype (Chris's repo):** A working Socket.IO + Fly.io app that the producer's guest Chris built using Claude. It rebuilt the producer's existing OBS overlay (backdrop, neon tile frames, name placards, topic bar) in code because Chris was working from a screenshot and didn't know those existed as discrete OBS sources.

**This project's purpose:** Take the genuinely good parts of Chris's work — the wrapper concept, the card UX, the emoji animation language — and re-implement them as a slim layer on top of the existing OBS scenes. Iterate weekly. Do not re-architect the working show.

---

## 2. Architecture

Three layers, with the existing OBS scene contents in between:

```
┌─────────────────────────────────────────────────────────────┐
│ TOP   /overlay (transparent browser source in OBS)          │
│       Renders emoji floats and card effects only.           │
│       Animates against fixed tile coordinates.              │
├─────────────────────────────────────────────────────────────┤
│ MID   Existing OBS scene contents                           │
│       Backdrop + tile frames + name placards + topic        │
│       graphic + 6 VDO.Ninja Browser Sources (guest cams).   │
│       Untouched by this project.                            │
├─────────────────────────────────────────────────────────────┤
│ BTM   (No bottom layer — backdrop is in the OBS scene)      │
└─────────────────────────────────────────────────────────────┘
                            ↓
                  OBS Virtual Camera (push=TBSqrdw)
                            ↓
        Host, editor, guests all view this composited feed
```

**Real-time data path:**

```
Guest taps emoji in /play wrapper
       ↓ postMessage to iframe
VDO.Ninja iframe sends P2P data to room peers
       ↓ data channel
/overlay browser source (joined room as data-only peer)
       ↓ renders animation
Composited into OBS scene → Virtual Camera → all viewers
```

End-to-end latency: ~100–300ms. The guest's local button has instant visual feedback so it never feels broken.

**No server. No central state. Static site only.**

---

## 3. Pages

### 3.1 `/play` — guest wrapper

URL pattern: `/?seat=<1-6>&push=<pushID>&label=<Guest1-6>` for guests; `/?role=host&push=Host1&label=Host` for the host.

Layout: VDO.Ninja iframe takes ~80% of the viewport width (left side). A vertical panel takes the remaining ~20% (right side). The iframe is the existing guest VDO.Ninja URL with all params preserved (see §6). VDO.Ninja's built-in chat stays inside the iframe (Option A from the brainstorm — Option B chat extraction is v2).

**Right panel contents, top to bottom:**
- Header: guest label (e.g., "KOHJI") + small LIVE indicator
- Cards row (side-by-side, 2 cards):
  - **SHUT THE !@#$ UP** — red-themed, shows `1 of 1 left · this topic` counter
  - **MIC DROP** — gold/amber-themed, shows `1 of 1 left · this topic` counter
- Tapping a card → full-screen modal with target picker showing the other 5 guests by name (using current roster) → tap target → fire and close
- Emoji grid: 10 emojis in 2 rows of 5 — `🔥 💀 😂 🤯 👀 💯 🤡 👍 👎 💩`
- Tapping an emoji: instant local visual feedback (button scales + glows briefly), broadcasts event, button stays tappable for spam (no rate limit in MVP — guests can spam to express intensity)
- Footer: small "GAMIFIED" wordmark in brand colors

**Host variant (`?role=host`):**
- Same layout, same controls
- The host's name is **omitted from card target pickers** — guests cannot card-target the host
- Otherwise identical

**Card counter behavior:**
- Counter persists in `localStorage` so refresh doesn't grant free cards
- Producer "Reset cards" event broadcasts to all wrappers → wrappers zero their counters and re-enable buttons
- Cards default to **1 use per topic per guest**
- Counter display: `1 of 1 left` → after use → `used` (button disabled, slightly dimmed)

### 3.2 `/overlay` — OBS browser source

Transparent background. Joins the VDO.Ninja room as a `&dataonly` peer (no video, no audio). Listens for emoji and card events. Renders animations at the tile coordinates from §5.

**Emoji animation:**
- On event, spawn one emoji at a random X within the sender's tile bounds, starting at the bottom edge
- Float up over ~1.5s with slight horizontal sway, scale up slightly, fade out near the top of the tile
- Multiple in-flight emojis from the same guest are fine — soft cap of 30 simultaneous per guest (more than enough; realistic spam tops out at 10–15)
- Emojis come from the **sender's** tile, not a target

**STFU card animation:**
- Mirrors Chris's design from his repo (red-themed, dramatic)
- Target's tile: red flash → dim/desaturate → "🤐" placard slam over the name → ~2.5s held → fade out and restore
- No audio in MVP

**MIC DROP card animation:**
- Gold/amber-themed, opposite energy from STFU
- Target's tile: gold spotlight beam down → mic SVG falls from top of tile with a small bounce → brief crown-glow ring around the placard → ~2.5s held → fade out
- No audio in MVP

**Calibration mode:**
- URL param `?calibrate=1` shows colored semi-transparent rectangles at each tile's coordinates
- Producer panel can toggle calibration mode on/off and edit coordinates with arrow-key nudges or direct input
- Calibrated values persist in `localStorage` on the overlay browser source's machine
- Default coords = the values in §5; calibration is an override

### 3.3 `/producer` — producer panel

Designed to dock inside OBS as a Custom Browser Dock (View → Docks → Custom Browser Docks). Also works as a standalone browser tab.

**Sections:**

1. **Roster names** — 6 text inputs (Guest 1–6) with a Save button. On save, broadcasts to all wrappers so target pickers show real names. Persists in `localStorage`.
2. **Reset cards** — single button. Confirmation prompt ("Reset all cards for all guests?") then broadcasts reset event.
3. **Calibration mode toggle** — checkbox to enable `?calibrate=1` on the overlay. When enabled, also shows 6 coordinate editors (X, Y, W, H per tile) with arrow-key nudge buttons.
4. **Activity feed** — small read-only log of recent events (last 20: "GUEST3 played STFU on GUEST5", "GUEST1 fired 🔥"). For spot-checking the connection during the show.

---

## 4. Emojis & cards (config)

### Emojis (final set, 10 total)

```ts
export const EMOJIS = ['🔥', '💀', '😂', '🤯', '👀', '💯', '🤡', '👍', '👎', '💩'];
```

Reserved for future iterations: 🥱 (yawn), 🧂 (salt) — both considered and shelved.

### Cards (final set, 2 total)

```ts
export const CARDS = [
  {
    id: 'stfu',
    name: 'SHUT THE !@#$ UP',
    color: 'red',
    usesPerTopic: 1,
    description: 'Cut off the current speaker',
  },
  {
    id: 'micdrop',
    name: 'MIC DROP',
    color: 'amber',
    usesPerTopic: 1,
    description: 'Crown the current speaker',
  },
];
```

Reserved for future cards: GOAT, FACTS — both pinned during brainstorm.

The cards system is built generically — adding a third or fourth card later is just a new config entry plus its visual treatment in `/overlay`.

---

## 5. Tile coordinates

Measured from the producer's actual OBS scenes (1920×1080 canvas):

| Slot | Guest    | x    | y   | width | height |
|------|----------|------|-----|-------|--------|
| L1   | Guest 1  | 94   | 53  | 280   | 280    |
| L2   | Guest 2  | 94   | 382 | 280   | 280    |
| L3   | Guest 3  | 94   | 717 | 280   | 280    |
| R1   | Guest 4  | 1544 | 53  | 280   | 280    |
| R2   | Guest 5  | 1545 | 385 | 280   | 280    |
| R3   | Guest 6  | 1544 | 719 | 280   | 280    |

These are the defaults. Calibration mode in `/producer` allows runtime adjustment without code changes.

The center area (~ x:540 to x:1380, y:150 to y:640) is reserved for the producer's existing topic graphics (game trailers, screenshots, etc.). The overlay must not render anything in this region.

---

## 6. VDO.Ninja URL handling

The wrapper preserves all of the producer's existing URL params and only adds itself as a layer on top. Constants (room-wide):

```
room=GamifiedShow
hash=1f71
q
tips
roombitrate=0
```

Per-guest variables (passed via wrapper URL):
- `push` (e.g., `i2zCGkA`)
- `label` (e.g., `Guest1`)

The wrapper builds the iframe `src` by combining the constants with the per-guest variables. **Do not** add `view=` to the iframe URL for guests — guests do not view other guests directly. They view the producer's Virtual Camera, which is already what the producer's room setup serves them.

For the **host** (`?role=host`), the iframe URL also includes `view=TBSqrdw` so the host sees the producer's composited feed. This matches the host's existing URL today.

The `/overlay` page joins the room as a data-only peer:
```
https://vdo.ninja/?room=GamifiedShow&password=gaming&dataonly&hash=1f71
```

Verify `&dataonly` does what we need before committing — fallback would be `&novideo&noaudio` or joining with a `&push=` of its own that no one views.

### Known issue to flag (not part of MVP build)
The editor's URL is missing `&roombitrate=0`, which is why they receive every guest's video and have to disable feeds manually. Producer is to fix this independently; not part of this project.

---

## 7. Hosting & deployment

- **Cloudflare Pages**, free tier, connected to the producer's GitHub fork of `chris-heatherly/gamified`
- `main` branch → production (e.g., `gamified.pages.dev`)
- `staging` branch → staging environment
- Feature branches → automatic preview URLs
- GitHub branch protection on `main`: require PR, require producer approval before merge
- Custom domain: TBD, free `.pages.dev` subdomain for MVP

---

## 8. Out of scope for MVP (deliberately)

These were discussed and explicitly deferred:

- Vote highlight borders (over/under, fair/foul color outlines on tiles) — **v2**
- Round transition animations in the center area — **v2** (requires OBS WebSocket integration)
- OBS WebSocket auto-trigger on scene switch — **v2**
- Chat extraction from VDO.Ninja iframe (Option B) — **v2**
- Sound effects on cards — possibly later
- More cards (GOAT, FACTS, etc.) — **future**
- Vote tallies, MVP picker, scoreboards, persistent state — **only if/when justified**, requires bringing back a server
- Mobile guest support — never (show is desktop-only)

---

## 9. Phasing

Build order, each phase shippable on its own:

1. **Cleanup** — delete legacy Socket.IO server, delete unused routes (LoginRoute, ProducerRoute, HostRoute, OverlayRoute, ContestantRoute)
2. **Config files** — `src/coords.ts`, `src/emojis.ts`, `src/cards.ts` (modified)
3. **VDO.Ninja library** — `src/lib/vdoninja.ts` for iframe API + sendData broadcasting
4. **`/play` wrapper** — iframe + right panel + emoji buttons + card buttons + target picker modal
5. **`/overlay`** — transparent canvas, event listener, emoji float animation, STFU + MIC DROP animations
6. **`/producer`** — roster, reset, activity feed, calibration mode
7. **Deploy** — Cloudflare Pages connection, branch protection, first staging push, first production deploy
8. **Show day prep** — OBS `_Overlay` scene setup, browser source URL, send producer the wrapper URLs to forward to guests

---

## 10. Open questions to revisit post-MVP

- Whether to add `&roombitrate=0` correctly to the editor's URL (not this project, but related)
- Whether codirector role overrides `roombitrate=0` in VDO.Ninja (worth asking VDO.Ninja Discord)
- Whether to migrate to OBS WebSocket integration for round transitions (v2)
- Whether to extract chat from iframe into wrapper panel (v2)

---

## Decisions Log

Architectural decisions made during v1.1 → v1.2 implementation. New agents should respect these unless explicitly rethinking them.

### Editor role (?role=editor)
- Editor publishes audio only via `&videodevice=0` (no camera prompt)
- Editor sees producer's virtual cam via `&broadcast` (same as guests)
- Wrapper renders chat-only panel — no cards, no emojis (editor isn't a participant)
- Editor is excluded from card target pickers (logic: `kind !== "guest"`)

### Host single-URL pattern (PR #22)
- Host's wrapper URL does everything in one link: publishes camera, joins as codirector, sees broadcast view, renders full panel
- URL pattern: `/play?role=host&push=<pushID>&label=<label>`
- Underlying VDO.Ninja URL: `dir=GamifiedShow&codirector=...&push=...&broadcast&pausepreview`
- Host's existing OBS Browser Source (`vdo.ninja/?view=<pushID>&solo&...`) continues to pull host's cam — single URL doesn't break this

### Data channel topology (PR #26)
- Producer joins the overlay context as "dataonly codirector" for bidirectional data flow
- This is what fixed the card reset bug after multiple failed attempts
- Do NOT revert to single-direction topologies (e.g. dataonly without codirector) — they break the reset bug fix

### Producer auth (PR #18)
- Password lives in `src/lib/auth.ts` as a constant
- `localStorage` key: `gamified.auth.v1`
- ONLY `/producer` is gated — `/play` and `/overlay` are open
- OBS Custom Browser Docks retain `localStorage`, so auth persists across OBS restarts

### Animation primitives
- All animations use CSS transforms, opacity, filter, box-shadow
- NEVER animate layout properties (top, left, width, height) — performance disaster in OBS browser source
- Existing keyframes in `src/index.css`: `slamIn`, `shake`, `stfuDim`, etc. — extend rather than replacing

### Chat infrastructure
- Chat uses VDO.Ninja's native chat (`postMessage` with `sendChat` / receive via `incoming-chat`)
- DOES NOT use the P2P data channel for chat
- VDO.Ninja's built-in chat UI inside the iframe is preserved as a fallback (do not hide it)

