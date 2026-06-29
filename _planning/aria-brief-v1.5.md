# Gamified v1.5 — Design Brief for Aria

**Date:** June 29, 2026
**From:** Cipher (engineering)
**To:** Aria (design)
**Re:** Visual design direction needed for 4 features in the next episode cycle

---

## Context

Gamified is a real-time overlay system for a weekly gaming podcast. Six guests + one host (Sam) + one producer (Lemz). The stack is React + Vite, deployed on Cloudflare Pages. The overlay runs inside an OBS browser source layer on top of camera feeds from VDO.Ninja.

**Critical architectural constraint:** The overlay is a separate OBS browser source layer painted on top of the video feeds. We cannot apply CSS filters (`grayscale()`, `blur()`, etc.) to the actual camera video. All visual effects must be painted as overlay divs that sit on top of the cameras in OBS compositing.

**Visual language:** Neon-on-dark aesthetic. Orbitron 900 for display text. Colors:
- STFU red: `#ff2e6b`
- MIC DROP green: `#00d96b`
- WRAP IT UP orange: `#ff7700`
- Source aura gold: `#ffd700`
- Background: very dark blue/purple (`#0a0610` ish)

---

## Feature 1: Card Play Glow — Visible Golden Perimeter

### What happens now

When a guest plays a card (STFU, MIC DROP, WRAP IT UP), a gold glow appears on the card player's tile for 3 seconds (300ms fade in, 2.4s hold, 300ms fade out).

### The problem

The current glow is invisible in 99% of cases. It uses inset box-shadows, meaning the glow goes inside the tile bounds — behind the camera feed. Against active camera video (bright, moving, colorful), a subtle inset gold glow disappears entirely.

### Current implementation

```tsx
// SourceAura component (OverlayRoute.tsx)
boxShadow: [
  "inset 0 0 35px rgba(255,215,0,0.6)",
  "inset 0 0 70px rgba(255,215,0,0.35)",
  "0 0 20px rgba(255,215,0,0.3)",
  "0 0 45px rgba(255,215,0,0.15)",
].join(", "),
border: "2px solid rgba(255,215,0,0.45)",
```

### What we need

A pronounced golden glow around the **perimeter** of the card player's camera tile — visible enough that the audience and other guests can clearly see who played the card.

### Options for Aria to mock up

**Option A — Outset glow ring**
- Flip from inset to outset box-shadows: glow extends outside the tile bounds
- `0 0 30px rgba(255,215,0,0.8)`, `0 0 60px rgba(255,215,0,0.5)`, `0 0 100px rgba(255,215,0,0.3)`
- Solid gold border (3-4px, `rgba(255,215,0,0.9)`)
- Static hold (no pulse) during the 2.4s hold phase

**Option B — Outset glow + animated pulse**
- Same outset glow as Option A
- Add a slow pulse animation during the hold phase (opacity 0.8 → 1.0 → 0.8 over 1s)
- More eye-catching but potentially distracting

**Option C — Thick border ring + subtle outer glow**
- Heavy solid gold border (5-6px, fully opaque)
- Minimal outer glow (`0 0 20px rgba(255,215,0,0.4)`)
- Reads as a clear "frame" around the player rather than a diffuse glow
- Clean, broadcast-friendly look

**Option D — Animated sweep border**
- Conic gradient border that rotates around the tile perimeter (CSS animation)
- Gold ring that moves around the tile edge like a loading spinner
- Visually distinctive but higher complexity

### What I need from Aria

Mock up all four options so Lemz can compare side by side. For each:
- How it looks on a 1920x1080 overlay with 6 camera tiles in 3x2 layout
- Opacity/intensity that reads clearly over bright camera video
- The gold color may need tuning (pure `#ffd700` vs warmer `#ffb800` vs `#ffe55c`)

The 3s duration (300ms in / 2.4s hold / 300ms out) can be adjusted if Aria has opinions on timing.

---

## Feature 2: STFU Silenced Effect — Better Grayscale

### What happens now

When a guest gets STFU'd, all other guests are force-muted for 10 seconds. The overlay shows a "SILENCED" visual on muted tiles.

### The problem

The current effect is a `rgba(50, 45, 60, 0.6)` semi-opaque gray-purple wash. It dulls the camera but doesn't read as "grayscale" — it looks like a dim colored veil. The effect needs to read clearly as "this person has been silenced" and feel more dramatic.

### Current implementation

```tsx
// MutedTileOverlay component (OverlayRoute.tsx)
// Layer 1: Desaturation wash
background: "rgba(50, 45, 60, 0.6)",

// Layer 2: SILENCED label
fontFamily: '"Orbitron", system-ui, sans-serif',
fontWeight: 900,
fontSize: labelSize,  // ~5% of tile width
color: "#ff2e6b",
textShadow: "0 0 8px rgba(0,0,0,0.8), 0 0 16px rgba(255,46,107,0.53)",
```

### Technical constraint (important)

We cannot apply `filter: grayscale()` to the camera video. The overlay is a separate OBS browser source. We can only paint overlay divs. So "grayscale" must be simulated with semi-opaque overlay layers.

### Options for Aria to mock up

**Option A — Pure neutral gray wash**
- Switch from purple-tint to pure neutral gray: `rgba(100, 100, 100, 0.7)`
- Higher opacity (0.7 vs current 0.6) for stronger effect
- Simple, clean, reads as "the color drained"

**Option B — Dark desaturation + frosted edge**
- Darker gray (`rgba(60, 60, 60, 0.75)`)
- Subtle inner shadow on tile edges for depth
- Slight border tint in STFU red to tie the effect to the card

**Option C — Heavy wash + vignette**
- Strong gray wash (`rgba(80, 80, 80, 0.8)`)
- Radial gradient vignette: darker at edges, slightly lighter at center
- Creates a "spotlight off" feeling
- Most dramatic, most cinematic

**Option D — Red-tinted prison bars effect**
- Gray wash (`rgba(70, 70, 70, 0.7)`)
- Thin vertical red lines over the tile (like prison bars or a "muted" speaker icon)
- Reads as "censored/silenced" rather than just "darkened"
- Most thematically tied to STFU

### Also needs design direction

- The SILENCED label: should it be bigger? Different position? Animated entrance (fade in, slide up, slam in)?
- Should there be a subtle animation on the wash itself (flicker, pulse) or is static better for broadcast?
- Duration: the mute lasts 10 seconds. Should the visual fade in/out, or snap on/off?

---

## Feature 3: Producer Panel UI Reorder

### Current layout (top to bottom)

```
1. Roster names (edit guest display names)
2. Calibration (tile position editors)
3. Reset cards (zero all card counters)
4. Buzz board (visual buzzer state for all 6 seats)
5. Activity feed (timestamped event log)
```

### New layout (top to bottom)

```
1. Roster names
2. Buzz board
3. Reset cards
4. Host tracker (NEW — see Feature 4)
5. Activity feed
6. Calibration (moved to bottom — rarely used mid-show)
```

### What I need from Aria

This is mostly a layout change, but if Aria has opinions on:
- Section spacing / visual hierarchy
- Whether the new tracker section should have a distinct visual treatment (border color, header style)
- Any collapsible sections (calibration could be collapsed by default)

---

## Feature 4: Host Tracker Display (new)

### What it does

The producer (Lemz) types a short answer for each of the 6 guests and hits send. The answers appear in real time on Sam's host display below his buzzer board, in a 2x3 grid.

### Use cases

- **Bullish or Bullshit:** mark which side each guest chose
- **What's the Word:** show each guest's word
- **Sentiment Score:** display each guest's score
- **MVP Pick:** show each guest's pick

### Where it appears

On Sam's host wrapper (`PlayRoute.tsx`), below the buzzer board:

```
┌─────────────────────────────────┐
│  [camera feed - VDO.Ninja iframe] │
├─────────────────────────────────┤
│  BUZZERS                         │
│  [L1] [L2] [L3]                  │
│  [R1] [R2] [R3]                  │
│                                  │
│  TRACKER                         │
│  ┌──────────┐  ┌──────────┐      │
│  │ L1: Bull │  │ L2: Bull │      │
│  │   ish    │  │   shit   │      │
│  └──────────┘  └──────────┘      │
│  ┌──────────┐  ┌──────────┐      │
│  │ L3: Bull │  │ R1: Bull │      │
│  │   ish    │  │   ish    │      │
│  └──────────┘  └──────────┘      │
│  ┌──────────┐  ┌──────────┐      │
│  │ R2: Bull │  │ R3: Bull │      │
│  │   shit   │  │   ish    │      │
│  └──────────┘  └──────────┘      │
│                                  │
│  [chat panel]                    │
└─────────────────────────────────┘
```

### Where the producer controls it

New section in the producer panel (position 4 in the new layout). Grid of 6 input fields matching the 2x3 layout, with a "Send to host" button.

### Real-time data flow (no page refresh needed)

This follows the exact same pattern as the existing roster name system. No page refresh, no API calls. The data flows through the VDO.Ninja P2P data channel:

1. **Producer types answers** in 6 input fields
2. **Producer clicks "Send to host"**
3. Producer sends a `trackerUpdate` event through the VDO.Ninja data channel (broadcasts to all peers)
4. **Sam's host wrapper receives** the `trackerUpdate` event via its `onMessage` handler
5. React state updates → the tracker grid re-renders instantly on Sam's screen
6. The event also appears in the producer's activity feed log (same as every other event)

This is the same mechanism that powers:
- Roster name updates (type names, save, they appear on all guests instantly)
- Buzzer state (guest buzzes, everyone sees it)
- Card plays (guest plays card, overlay animates on all screens)

Latency: effectively instant (P2P WebRTC data channel, typically <50ms on same-network).

### Visual style to match

The tracker display on Sam's side should match the existing visual style of:
- The **HostMutePanel** (mute buttons for each seat — neon bordered buttons with seat labels)
- The **BuzzPanel** (buzzer buttons — 3x2 grid with glow effects)

Both use: Orbitron font, neon border colors, dark backgrounds with subtle glow, consistent border radius and spacing.

### Alternatives for Aria to consider

**Layout Option A — Table/grid**
Straight 2x3 grid as shown above. Each cell has the guest name as a header and the answer below it.

**Layout Option B — List rows**
Single column with all 6 answers stacked. More vertical space but wider per-answer.

**Layout Option C — Compact badges**
Smaller, denser cells with name + answer on the same line. Takes less screen space.

### What I need from Aria

For the host-side display:
- Mock up the tracker grid in context with the buzzer board above it
- Pick the layout option that looks best with the existing neon aesthetic
- Style the cells to match the mute/buzz panel visual language
- Consider: should empty (not yet sent) cells show a placeholder, or be invisible?

For the producer-side input panel:
- Should the 2x3 input grid mirror the exact layout of the host display?
- Should the "Send" button also clear the fields, or keep them for a second send?
- Clear button styling

### Data shape (for reference, not design)

```typescript
// New event type (follows RosterUpdateEvent pattern)
interface TrackerUpdateEvent {
  type: "trackerUpdate";
  answers: Record<SeatId, string>;  // { L1: "Bullish", L2: "Bullshit", ... }
  ts: number;
}
```

---

## Feature 5: Buzzer Timer Change (no design needed)

Current: buzzers auto-clear after 2 minutes.
New: buzzers auto-clear after 5 minutes.

Pure code change, no visual impact. Included for completeness.

---

## Summary for Aria

| Feature | What I need | Mockups required |
|---------|-------------|------------------|
| Card play glow | 4 options mocked up | Yes — all 4 on a 6-tile overlay |
| STFU silenced effect | 4 options mocked up | Yes — all 4 on a single tile with camera |
| Producer panel reorder | Layout opinion | Optional — if she has thoughts on visual treatment |
| Host tracker display | Layout + styling | Yes — 2-3 layout options in context with buzzers |

### Reference files (if Aria wants to see the current code)

- Overlay route: `src/routes/OverlayRoute.tsx` (SourceAura at line 884, MutedTileOverlay at line 923)
- Host wrapper: `src/routes/PlayRoute.tsx` (buzzer board at line 624, mute panel at line 620)
- Producer panel: `src/routes/ProducerRoute.tsx` (section layout, roster, buzz, activity feed)
- Cards definition: `src/cards.ts`
- VDO.Ninja data channel: `src/lib/vdoninja.ts` (event types, validation, data flow)
- Existing mockups: `_planning/` directory in the repo has v1.4 mockups from the last round
- CSS: `src/index.css` (keyframes, fonts, global styles)

### Existing visual references (v1.4 mockups)

Previous mockup HTML files are in `_planning/`:
- `gamified-v1.4-mockup.html`
- `gamified-v1.4-mockup-v2.html`
- `gamified-v1.4-mockup-v3.html`
- `gamified-v1.4-mockup-v3-final.html`

These show the overlay layout (3x2 tiles, neon aesthetic, card animations). The new mockups should use the same base layout.

---

## Backlog (not in this design brief)

- **Chat-to-screen:** Push selected chat messages to the overlay (like YouTube live comment highlighting). Deferred until features 1-4 are shipped and tested. Will need its own design brief when picked up.
- **Move room credentials to env vars:** Deprioritized. Only relevant if we go live broadcast. Current setup is fine for recorded shows.
- **Hoist static inline styles:** Performance optimization deferred after React.memo + sweep. Profile first.
- **Drop react-router-dom:** ~20KB bundle savings. Optional.

---

_Questions for Aria? Ping Cipher on Discord. All the technical context is above — design direction is yours._
