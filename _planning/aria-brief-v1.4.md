# Creative Brief: Gamified v1.4 — Visual Effects for Mute & Card Source

## Context

Gamified is a real-time gamification overlay for a weekly gaming podcast. Six guests on camera, one host (off-camera producer), episodes are recorded via OBS + VDO.Ninja. The system has three surfaces:

1. **`/play`** — Guest wrapper page (iframes VDO.Ninja + sidebar with cards, emojis, chat, buzzer)
2. **`/overlay`** — Transparent OBS browser source (renders on top of all scenes, shows emoji floats, card animations, center-screen announcements)
3. **`/producer`** — Producer's control panel (roster, mute, card reset, calibration)

This brief covers new visual effects needed for the **overlay** and the **guest wrapper** sidebar.

---

## Feature 1: Muted Camera Visual Treatment

### Problem
When a guest is muted (either by the host via the mute panel or via an STFU card), there is **no visual indicator on their camera** in the overlay. The mic icon turns off in VDO.Ninja, but that's subtle and easy to miss during a live show.

### Requirements
- When a guest is muted, their camera tile in the overlay should show a **desaturated / grayscale-like visual effect** so it's immediately obvious they're silenced.
- A **"SILENCED" label** should appear on the muted camera.
- The effect should look the same regardless of mute source (host mute or STFU card) — "muted is muted."
- The host has no camera tile, so this only applies to the 6 guest seats.

### Technical Constraint (Critical)
The overlay is a **separate browser source** layered on top of the OBS video. We **cannot** apply CSS `filter: grayscale()` to the underlying OBS video sources. They live in different layers.

What we CAN do: paint a **semi-transparent overlay** on top of the muted guest's tile rectangle (we already do this for the STFU dim wash — dark overlay with red glow). The "grayscale" effect would be achieved by a **heavily desaturated, semi-opaque layer** that washes out the color of the camera beneath it.

### Tile geometry
Each guest has a tile on the 1920×1080 canvas:

```
L1: { x: 94,   y: 53,  w: 280, h: 280 }  // top-left
L2: { x: 94,   y: 382, w: 280, h: 280 }  // middle-left
L3: { x: 94,   y: 717, w: 280, h: 280 }  // bottom-left
R1: { x: 1544, y: 53,  w: 280, h: 280 }  // top-right
R2: { x: 1545, y: 385, w: 280, h: 280 }  // middle-right
R3: { x: 1544, y: 719, w: 280, h: 280 }  // bottom-right
```

Tiles have rounded corners (border-radius ~22% of shorter side ≈ 62px). The overlay effect needs to respect these rounded corners.

### Existing precedent
The STFU card animation already paints a dark overlay + red glow ring on the target tile. The muted camera treatment should feel related but distinct — it's a sustained state (not a 2.5s animation), and it should read as "off/silenced" rather than "punished."

### Design decisions needed from Aria
1. **Opacity and color** of the desaturation overlay. Too opaque = you can't see the person. Too subtle = not obvious they're muted. What's the right balance?
2. **"SILENCED" text treatment:** Font, size, position within the tile, color, glow/shadow. Should it be centered? Top-aligned? With an icon (mic-off)?
3. **Animation on entry/exit:** Should the mute effect fade in/out, or snap? A quick fade (200-300ms) feels polished.
4. **Relationship to STFU card animation:** When STFU plays, the existing card animation (red flash, dim wash, slam text) runs for 2.5s. After that, should the muted camera state persist with this new treatment? Or should the card animation end and the muted state look different?

---

## Feature 2: Card Source Highlighting

### Problem
When a guest plays a card (STFU, MIC DROP, WRAP IT UP), the card animation only shows on the **target's** camera tile. There is no visual indicator of **who played the card** — only the center-screen text announcement ("GUEST played STFU on TARGET").

### Requirements
- When a guest plays a card, their own camera tile should show a **subtle highlight/aura** to indicate they are the source.
- The highlight should use the card's theme color (STFU = red, MIC DROP = green, WRAP IT UP = yellow).
- The highlight should be **more subtle** than the target's animation — think "warming glow" not "slam effect."
- Duration: should match or slightly exceed the target's card animation duration (currently 2.5s).
- The host has no camera tile, so source highlighting only applies to guest sources. This is acceptable — if no guest is highlighted, it's implicitly the host.

### Technical details
- The overlay already receives `cardPlay` events with `from.seat` (the source) and `targetSeat` (the target). Both positions are known.
- This is purely an overlay render — no changes to VDO.Ninja or the wrapper needed.

### Existing precedent
The target's card animations are dramatic: flash, glow ring, slam text, emoji. The source highlight should feel like a softer version — perhaps just the glow ring at lower intensity, with no slam text or flash.

### Design decisions needed from Aria
1. **Visual treatment:** Glow ring? Pulsing border? Soft radial highlight? Something else?
2. **Intensity relative to the target animation:** How subtle is "subtle"? 30% of the target's glow? 50%?
3. **Should the source's name appear?** Or is the glow + center-screen announcement enough?
4. **Animation curve:** Fade in quickly, hold, fade out? Or pulse gently during the duration?

---

## Feature 3: STFU Cooldown Timer (Guest Wrapper)

### Problem
A new STFU lockout mechanic prevents other guests from playing STFU for 10 seconds after one is played (prevents instant retaliation). Guests need to see that their STFU card is locked and understand why.

### Requirements
- When the STFU lockout is active, the STFU card button in the guest's sidebar should appear **greyed out / disabled**.
- A **countdown timer** should be visible on the card showing seconds remaining until it becomes available again (e.g., "8s" → "7s" → ... → "0s" → card re-enables).
- Timer should be styled to match the existing neon dark theme (NEON palette: bg #08080d, pink #ff2e9f, red #ff2e6b, cyan #22e2ff, green #00d96b, amber #ffb000).

### Existing card button design
Each card is a vertical button in a 3-column grid showing: icon, slug name (e.g., "STFU"), subtitle, and usage counter. Currently when a card is "used" (0 remaining), it goes grey with 0.55 opacity. The lockout state should feel similar but distinct — the card isn't permanently used, it's just on cooldown.

### Design decisions needed from Aria
1. **Timer placement and size:** Overlay the timer on the card icon? Below the slug? Replace the usage counter text?
2. **Timer styling:** Numeric countdown? Circular progress indicator? Minimal text?
3. **Visual distinction from "used" state:** The used state already greys out the card. How does the cooldown state look different? Maybe the STFU card pulses its red border faintly during countdown to show it's "charging back up"?

---

## Theme Reference

The visual language is **neon-on-dark cyberpunk** — glowing borders, text shadows, smooth animations. Orbitron font for display text, Inter for body. Key colors from the codebase:

| Token | Hex | Usage |
|-------|-----|-------|
| BG | #08080d | Page background |
| Panel BG | #0e0e16 | Sidebar background |
| Panel Edge | #1f1f30 | Borders, dividers |
| Text | #f0f0f8 | Primary text |
| Text Dim | #8a8aa3 | Secondary text |
| Pink | #ff2e9f | Wordmark, accents |
| Purple | #a855ff | Ambient glow |
| Cyan | #22e2ff | Guest labels, send button |
| Red | #ff2e6b | STFU card |
| Green | #00d96b | MIC DROP card |
| Amber | #ffb000 | MIC DROP glow |
| Yellow | #ffcc00 | WRAP IT UP card |

---

## Out of Scope (for this round)

- Host mute visual differentiation — mute is mute, same treatment regardless of source
- Host card source highlighting (host has no tile)
- New card types
- Changes to emoji reactions or chat
