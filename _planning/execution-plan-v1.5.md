# Gamified v1.5 — Execution Plan

**Date:** June 29, 2026
**Author:** Cipher (Engineering)
**Based on:** Aria's v1.5 Design Spec + codebase analysis
**Status:** Ready for review — DO NOT EXECUTE until approved

---

## Technical Corrections to Aria's Spec

### Correction 1: STFU silenced — trying Aria's `mix-blend-mode: saturation` approach

Aria's spec (§2) proposes using `mix-blend-mode: saturation` with `background: #808080` to achieve a grayscale effect on muted tiles. The existing codebase comment (line 937) claims this won't work across OBS source layers, but we're not certain this specific approach was actually tested.

**Decision:** Build it Aria's way. If it doesn't composite correctly in OBS, the fallback is swapping `mixBlendMode: "saturation"` for a neutral gray `background: rgba(95, 95, 95, 0.72)` — one line change, same component, same label animation. We'll know in 30 seconds of testing in OBS.

### Correction 2: Tracker display goes in PlayRoute, not OverlayRoute

Aria's spec (§6) lists `OverlayRoute.tsx` for "tracker display." The tracker is Sam's host-side display — it appears below the buzzer board on his wrapper (`PlayRoute.tsx`), not on the OBS overlay. The overlay is the broadcast-facing OBS browser source; Sam's host wrapper is his personal view.

**Files actually touched:**

| File | Change |
|------|--------|
| `src/routes/OverlayRoute.tsx` | Modify SourceAura + MutedTileOverlay only |
| `src/routes/ProducerRoute.tsx` | Add tracker section + reorder panels |
| `src/routes/PlayRoute.tsx` | Add tracker display (host side) + handle `trackerUpdate` event |
| `src/lib/vdoninja.ts` | Add `TrackerUpdateEvent` type + validation |
| `src/routes/PlayRoute.tsx` | Add `trackerUpdate` to activity feed format |
| `src/routes/ProducerRoute.tsx` | Add `trackerUpdate` to activity feed format |
| `src/index.css` | Keyframe for label animation if needed |

### Correction 3: Roster names are dynamic

Aria's spec hardcodes guest names (Tony, dub, Payton, Chris, Kohji, Wills). The roster is editable in the producer panel and stored in localStorage. The tracker uses the dynamic `roster` state, same as BuzzPanel and HostMutePanel. No hardcoded names anywhere.

### Correction 4: Inline styles, not CSS classes

The codebase uses inline styles throughout (React `style={{...}}` objects). Aria's spec uses CSS class syntax (`.aura-overlay`, `.silence-overlay`, etc.). I'll convert to inline styles for consistency. Aria's CSS values are the source of truth for visual parameters.

### Correction 5: Aura "sibling div" is already implemented

Aria's spec says to position the aura as a "sibling div at tile coords, not a child." The current `SourceAura` already uses `cardBoxStyle(tile)` which does exactly this — absolute positioning at tile coords with 10px bleed, no overflow:hidden, no borderRadius. This is correct. I just need to update the opacity values and remove the border.

### Note 6: BuzzPanel grid vs tracker grid (different by design)

BuzzPanel renders as 3 columns × 2 rows (L1/L2/L3 in row 1, R1/R2/R3 in row 2). The tracker grid is 2 columns × 3 rows (L1/R1 in row 1, L2/R2 in row 2, L3/R3 in row 3). Different layouts, different components — this is intentional per the design spec.

---

## Implementation Plan

### Phase 1: Quick wins (no design dependency)

#### 1.1 Buzzer timer 120s → 300s

**File:** `src/routes/PlayRoute.tsx`
**Change:** `const BUZZ_AUTO_OFF_MS = 120_000;` → `300_000`
**Also update:** Comments on lines 248 and 654 from "120s" to "300s"
**Effort:** 1 line + 2 comments. **Risk:** none.

#### 1.2 Producer panel reorder

**File:** `src/routes/ProducerRoute.tsx`
**Change:** Reorder `<Section>` blocks:
1. Roster names (stays)
2. Buzz board (moved up from position 4)
3. Reset cards (stays at 3)
4. Host tracker (NEW — placeholder for Phase 3)
5. Activity feed (moved down from 5)
6. Calibration (moved to bottom, add collapsed toggle)

**Collapsed calibration:** Add a boolean toggle state `showCalibration` (default false). When collapsed, hide the calibration grid and show a "Show coordinate editors" toggle. The toggle already exists (line 417-427) — I just need to change the default from `false` to `false` (it's already `false`, just needs the section repositioned).

Actually, looking at it, the calibration toggle already exists and defaults to unchecked. Moving the whole section to the bottom is the only change needed for the "collapsed by default" behavior — the checkbox controls the content visibility, not the section position. **Risk:** none. **Effort:** 10 min.

---

### Phase 2: Visual effects (tuning existing components)

#### 2.1 Card play glow rework

**File:** `src/routes/OverlayRoute.tsx` — `SourceAura` component (line 884)

**Current:**
```tsx
boxShadow: [
  "inset 0 0 35px rgba(255,215,0,0.6)",
  "inset 0 0 70px rgba(255,215,0,0.35)",
  "0 0 20px rgba(255,215,0,0.3)",     // outset — remove per Aria
  "0 0 45px rgba(255,215,0,0.15)",    // outset — remove per Aria
].join(", "),
border: "2px solid rgba(255,215,0,0.45)",  // remove per Aria
```

**New (per Aria's spec):**
```tsx
boxShadow: [
  "inset 0 0 20px rgba(255,215,0,0.85)",
  "inset 0 0 45px rgba(255,215,0,0.60)",
  "inset 0 0 80px rgba(255,215,0,0.35)",
  "inset 0 0 120px rgba(255,215,0,0.18)",
].join(", "),
// No border — Aria spec says "no solid border"
```

**Changes:**
- Remove all outset shadows
- Remove border
- Increase inset opacity cascade: 0.85/0.60/0.35/0.18 (from 0.6/0.35)
- Widen spread: 20px/45px/80px/120px (from 35px/70px)
- Keep the 3s animation timing (300ms in / 2.4s hold / 300ms out)
- Keep `cardBoxStyle(tile)` sibling positioning (already correct)

**Concern:** Aria's specular values are strong — 0.85 opacity on a 20px inset glow is very hot. But the current implementation is too subtle to see, so this is the right direction. If it's too intense in testing, I'll dial down the innermost layer. The opacity curve should read as a gradient from edge (bright) to center (dim).

**Keyframe interaction:** The existing `@keyframes sourceAuraGlow` (index.css lines 641-649) peaks at opacity 0.9. With the new boxShadow values (0.85 innermost), the effective peak would be ~0.9 x 0.85 = 0.765 — very intense. The keyframe opacity ceiling may need lowering (e.g. to 0.7) alongside the inline values. Both the keyframe and the inline values are multiplicative.

**Risk:** low. Pure visual tuning. **Effort:** ~15 lines.

#### 2.2 STFU silenced effect rework

**File:** `src/routes/OverlayRoute.tsx` — `MutedTileOverlay` component (line 923)

**Current:**
```tsx
background: "rgba(50, 45, 60, 0.6)",  // purple-tinted gray
borderRadius: Math.round(Math.min(tile.w, tile.h) * 0.18),  // ~62px
// Label: static opacity, no scale animation
```

**New (per Aria's spec — `mix-blend-mode: saturation`):**
```tsx
background: "#808080",  // solid gray, 0% saturation — required for blend mode
mixBlendMode: "saturation",  // forces saturation to 0 = grayscale effect
borderRadius: Math.round(Math.min(tile.w, tile.h) * 0.22),  // match tile radius
// Label: fade in + scale animation per Aria's spec
```

**Fallback (if OBS doesn't composite the blend):**
```tsx
background: "rgba(95, 95, 95, 0.72)",  // pure neutral gray, higher opacity
// Remove mixBlendMode line
```

**Important:** The background must be a solid color (`#808080`), not `rgba()`, for `mix-blend-mode: saturation` to have a meaningful saturation value. The opacity is controlled via transition on the element, not via the background alpha.

**Label changes per Aria's spec:**
- Add scale animation: `transform: translateX(-50%) scale(1.2)` → `scale(1)` on activation
- Transition: `transform 300ms cubic-bezier(0.2, 1.5, 0.4, 1)` (overshoot/bounce)
- Slightly lower label position: `bottom: 14%` (from `18%`)
- Stronger text shadow: `0 0 10px rgba(0,0,0,0.85), 0 0 20px rgba(255,46,107,0.6)`

**Timing changes:**
- Fade in: 300ms (from 250ms)
- Fade out: 400ms (from 250ms)

**Label animation (important):** The current `MutedTileOverlay` conditionally mounts/unmounts — it has no active/inactive state toggle. CSS `transition` requires a state change to fire and does nothing on initial mount. Use a CSS `@keyframes` animation instead (same pattern as `sourceAuraGlow`, `stfuGlowRing`, etc.).

**New keyframe in `src/index.css`:**
```css
@keyframes silencedLabelIn {
  0% { opacity: 0; transform: translateX(-50%) scale(1.2); }
  100% { opacity: 1; transform: translateX(-50%) scale(1); }
}
```
Apply via `animation: "silencedLabelIn 300ms cubic-bezier(0.2, 1.5, 0.4, 1) forwards"` on the label element.

**Risk:** low. **Effort:** ~25 lines.

---

### Phase 3: Host Tracker (new feature)

#### 3.1 Data channel event type

**File:** `src/lib/vdoninja.ts`

Add new event interface:
```typescript
/** Producer sent tracker answers to the host display. */
export interface TrackerUpdateEvent {
  type: "trackerUpdate";
  /** Display title for the current tracker (e.g. "Bullish or Bullshit"). */
  title: string;
  /** Answers keyed by seat — empty string means "not yet answered". */
  answers: Record<SeatId, string>;
  ts: number;
}
```

Add `"trackerUpdate"` to:
- `EventPayload` union type (line 340-351)
- `VALID_TYPES` set (line 355-358)
- Validation switch in `validatePayload` (line 380-402) — validate `answers` is a non-null object with string values:

```typescript
case "trackerUpdate":
  if (!p.answers || typeof p.answers !== "object") return null;
  break;
```

**Effort:** ~20 lines. **Risk:** low.

#### 3.2 Producer panel — tracker section

**File:** `src/routes/ProducerRoute.tsx`

**New state:**
```typescript
const [trackerTitle, setTrackerTitle] = useState("");
const [trackerDraft, setTrackerDraft] = useState<Record<SeatId, string>>(
  () => Object.fromEntries(SEAT_ORDER.map(s => [s, ""])) as Record<SeatId, string>
);
```

**New section (position 4 in reordered panel):**
- Title input: single text field, placeholder "Tracker title..."
- 6 answer inputs in 2×3 grid:
  - Row 1: L1 label + input | R1 label + input
  - Row 2: L2 label + input | R2 label + input
  - Row 3: L3 label + input | R3 label + input
  - Labels use dynamic roster names (e.g. "L1 · Tony")
  - Inputs use the gold-tinted section border (`rgba(255, 215, 0, 0.3)`)
- Send button: gold primary, sends `trackerUpdate` event, does NOT clear inputs
- Clear button: secondary bordered, empties all inputs + sends cleared state to host

**Send behavior:**
```typescript
const sendTracker = useCallback(() => {
  send({
    type: "trackerUpdate",
    title: trackerTitle || "Tracker",
    answers: trackerDraft,
    ts: Date.now(),
  });
}, [trackerTitle, trackerDraft, send]);
```

**Clear behavior:** Reset all fields to empty, then send the empty state to host. **Important:** Must construct the empty answers inline and call `send()` directly — NOT through `sendTracker()`, which would capture the stale `trackerDraft` in its closure (React state updates are async):

```typescript
const clearTracker = useCallback(() => {
  const empty = Object.fromEntries(SEAT_ORDER.map(s => [s, ""])) as Record<SeatId, string>;
  setTrackerDraft(empty);
  setTrackerTitle("");
  send({ type: "trackerUpdate", title: "Tracker", answers: empty, ts: Date.now() });
}, [send]);
```

**Activity feed:** Add `trackerUpdate` to `formatEvent()`:
```typescript
case "trackerUpdate":
  return `Tracker updated: ${msg.title}`;
```

**Styling:** Match existing neon aesthetic. Gold accents per Aria's design tokens. Section header in Orbitron gold. Input borders gold-tinted.

**Risk:** low — follows `rosterUpdate` pattern exactly. **Effort:** ~100-120 lines.

#### 3.3 Host display — tracker grid

**File:** `src/routes/PlayRoute.tsx`

**New state:**
```typescript
const [tracker, setTracker] = useState<{
  title: string;
  answers: Record<SeatId, string>;
} | null>(null);
```

**New onMessage handler (in the existing switch):**
```typescript
case "trackerUpdate":
  setTracker({ title: msg.title, answers: msg.answers });
  break;
```

**New section (below buzzers, host only — `identity.kind === "host"`):**

**Layout note:** The PlayRoute panel uses `flexDirection: column` with `overflowY: auto`. The chat panel has `flex: "1 1 auto"`. The tracker section MUST use `flex: "0 0 auto"` to prevent it from expanding and pushing chat below the fold. The buzzer section already behaves this way implicitly.

Layout: 2 columns × 3 rows, left = L seats, right = R seats:
```
L1: [name]   R1: [name]
[answer]     [answer]

L2: [name]   R2: [name]
[answer]     [answer]

L3: [name]   R3: [name]
[answer]     [answer]
```

**Cell dimensions:** ~42px tall per Aria's spec.

**Typography per Aria:**
- Names: 8px, uppercase, letter-spacing 0.6px, color `#8a8aa3`
- Answers: 12px Orbitron 900, color `#ffe866`, text-shadow glow
- Empty state: "Waiting..." at 35% opacity, italic, no glow
- Title: gold header above the grid, uses the title from the producer

**Grid structure:**
```tsx
// Interleave: [L1, R1], [L2, R2], [L3, R3]
const trackerRows = [
  ["L1", "R1"],
  ["L2", "R2"],
  ["L3", "R3"],
] as const;
```

**Send button on producer side does NOT clear inputs.** Producer can adjust and re-send. Each send replaces the host display instantly via React state update.

**Real-time flow (no page refresh):**
1. Producer types answers → clicks Send
2. `send({ type: "trackerUpdate", ... })` fires through VDO.Ninja data channel
3. Host's `onMessage` receives `trackerUpdate` event
4. `setTracker(...)` updates React state
5. Host's tracker grid re-renders instantly (<50ms latency on P2P)
6. Event also logs in producer's activity feed

**Risk:** low — follows existing event patterns. **Effort:** ~80-100 lines.

#### 3.4 Activity feed integration

**File:** `src/routes/ProducerRoute.tsx` only (PlayRoute has no `formatEvent` or activity feed)

Add `trackerUpdate` case to `formatEvent()`:

```typescript
case "trackerUpdate":
  return `Tracker: ${msg.title}`;
```

**Effort:** ~4 lines. **Risk:** none.

---

### Phase 4: Aria design brief handoff (already written)

The brief at `_planning/aria-brief-v1.5.md` has been superseded by Aria's actual design spec. No further action needed.

---

## Execution Order

| Step | Item | Depends on | Est. effort |
|------|------|------------|-------------|
| 1 | Buzzer timer 120s → 300s | Nothing | 5 min |
| 2 | STFU silenced effect rework | Nothing | 30 min |
| 3 | Card play glow rework | Nothing | 20 min |
| 4 | Add `TrackerUpdateEvent` to vdoninja.ts | Nothing | 15 min |
| 5 | Producer panel reorder (sections only) | Nothing | 10 min |
| 6 | Producer tracker section + state | Step 4 | 90 min |
| 7 | Host tracker display + onMessage | Step 4 | 60 min |
| 8 | Activity feed integration | Step 4 | 5 min |

**Build + test:** After each step, `npm run build` to verify type-check + bundle. After steps 2-3, visual test with `?calibrate=1` on the overlay. After steps 6-7, functional test: producer sends tracker → host receives.

**Total est. effort:** ~4 hours of code work.

## Verification Checklist (per Aria's §7)

- [ ] Aura renders as glow on the correct tile (sibling div, no border clipping)
- [ ] Aura opacity cascade reads clearly over bright camera video
- [ ] STFU renders grayscale effect via `mix-blend-mode: saturation` (or fallback gray wash if OBS doesn't composite it)
- [ ] STFU label animates in with scale + opacity (cubic-bezier overshoot)
- [ ] Tracker grid matches L1/R1, L2/R2, L3/R3 layout
- [ ] Tracker answers update on host when producer hits Send (no refresh)
- [ ] Tracker Clear resets inputs AND sends cleared state to host
- [ ] Tracker cells are compact (~42px) and don't push chat offscreen
- [ ] Producer panel shows Tracker section in correct position (4th)
- [ ] Producer panel shows Calibration at bottom
- [ ] Buzzer auto-off is 5 minutes
- [ ] Tracker update appears in activity feed log
- [ ] All effects use CSS transitions for smooth fade in/out
- [ ] `npm run build` passes clean
