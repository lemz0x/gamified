# Chat-to-Screen Feature — Implementation Plan v2

> **Status:** Audited. v1 was reviewed by two independent subagent passes (architecture + edge cases). All HIGH/MEDIUM issues addressed below. Ready for implementation review.

## 1. Feature Summary

Allow the producer to select chat messages from the VDO.Ninja chat feed and push them to the OBS overlay as styled on-screen text graphics. The audience sees the selected message rendered with Gamified's neon aesthetic, attributed to the sender.

**Core flow:** Producer sees chat messages arriving in the producer panel (via a dedicated chat iframe) -> clicks one to feature it -> message appears on the overlay with entrance animation -> auto-dismisses after 20s or producer clears it manually.

---

## 2. Architecture Context

### 2.1 Existing Systems

| System | Transport | Files | Purpose |
|--------|-----------|-------|---------|
| VDO.Ninja data channel (P2P) | `sendData` via iframe postMessage | `src/lib/vdoninja.ts` | Game events (emoji, cards, roster, tracker, buzz, mute) |
| VDO.Ninja chat (websocket) | `sendChat` / `incoming-chat` via iframe | `src/lib/vdoninjaChat.ts` | Text chat between room participants |
| Overlay route | Renders sprites on transparent canvas | `src/routes/OverlayRoute.tsx` | OBS browser source — emoji floats, card anims, STFU overlay |
| Producer route | Control panel | `src/routes/ProducerRoute.tsx` | Roster, cards, tracker, calibration, activity feed |
| Chat route | Standalone chat UI | `src/routes/ChatRoute.tsx` | Lemz's chat window |

### 2.2 Transport Decision: P2P data channel for feature events

**Decision: The `chatToScreen` and `chatToScreenClear` events ride the P2P data channel (`sendData`), NOT VDO.Ninja chat.**

Rationale:
- The overlay only listens on the P2P data channel (`useVdoNinja({ onMessage })`). Adding chat event handling to the overlay would require coupling it to `useVdoNinjaChat` — wrong transport, extra complexity.
- The P2P channel is already proven for producer-to-overlay events (rosterUpdate, trackerUpdate, calibration, cardReset).
- The producer already has a `send()` function on the P2P channel.

**Chat messages stay on VDO.Ninja's websocket chat.** We don't change how chat works. We only add the ability for the producer to "feature" a message by sending a new event type on the P2P channel.

### 2.3 Producer Chat Iframe — CRITICAL DESIGN DECISION

**Auditing finding I-1 (HIGH):** The v1 plan assumed the producer's existing codirector + dataonly iframe could also receive VDO.Ninja chat events. This is unverified and likely wrong:
- `buildChatOnlyUrl` was deliberately built as a separate, simpler URL (`videodevice=0&audiodevice=0&autostart&cleanoutput`, no `dir`, no `codirector`, no `dataonly`).
- Neither existing consumer of `useVdoNinjaChat` (ChatRoute, PlayRoute) uses the codirector/dataonly iframe.
- The codirector topology is fundamentally different from a regular room join.

**Resolution: The producer panel gets a SECOND hidden iframe** loaded from `buildChatOnlyUrl({ push, label })`, specifically for chat reception. The existing data-only codirector iframe stays untouched.

This means:
- **Iframe 1 (existing):** `buildOverlayDataOnlyUrl()` — P2P data channel for game events
- **Iframe 2 (NEW):** `buildChatOnlyUrl({ push, label })` — VDO.Ninja chat websocket

The chat iframe's `ref` is passed to `useVdoNinjaChat()`. The data channel iframe's `ref` continues to be passed to `useVdoNinja()`.

**Producer chat params:** `push` can be empty or a throwaway stream ID, `label` should be `"Producer"` so messages from the producer (if they ever send) are attributable. We only receive, never send, in the producer's chat iframe.

---

## 3. Event Design

### 3.1 New Event Type: `chatToScreen`

```typescript
export interface ChatToScreenEvent {
  type: "chatToScreen";
  /** Display name of the chat sender (from VDO.Ninja label). */
  author: string;
  /** The message text to display. Plain text, HTML already stripped by parseChatBody. */
  message: string;
  /** Wall-clock timestamp (ms). */
  ts: number;
}
```

**Removed from v1:** The `seat?: SeatId` field. The producer's chat pipeline provides `{label, msg, ts}` — no seat. The producer's roster names don't reliably match VDO.Ninja labels. Carrying an always-undefined field is dead weight on the wire protocol. (Audit finding I-6.)

### 3.2 Clear Event: `chatToScreenClear`

```typescript
export interface ChatToScreenClearEvent {
  type: "chatToScreenClear";
  ts: number;
}
```

### 3.3 Registration

Both events are:
- Added to the `EventPayload` discriminated union
- Added to `VALID_TYPES` set
- Given validation branches in `validatePayload`

### 3.4 Validation

In `validatePayload`, structural checks only (matching the existing "defensive, not exhaustive" contract):

```typescript
case "chatToScreen":
  if (typeof p.author !== "string" || p.author.trim() === "") return null;
  if (typeof p.message !== "string" || p.message.trim() === "") return null;
  break;
case "chatToScreenClear":
  // No fields beyond type + ts
  break;
```

**Note on length caps (audit finding I-3):** `validatePayload` does NOT enforce max message length. The existing contract is "structural only, just enough to prevent crashes" (comment at line 391 of vdoninja.ts). No existing event enforces string length caps. Length truncation happens at the render side in `ChatScreenCard` (see S5.4). This keeps `validatePayload` consistent with its stated contract.

---

## 4. Producer Panel Changes

### 4.1 New Hidden Chat Iframe

```typescript
// Producer route gets a second iframe ref for chat
const chatIframeRef = useRef<HTMLIFrameElement>(null);
const chatIframeSrc = useMemo(
  () => buildChatOnlyUrl({ push: "", label: "Producer" }),
  [],
);
```

The chat iframe is hidden (same `hiddenIframe` style as the existing data iframe). It joins the VDO.Ninja room as a regular participant (no camera, no mic) and receives `incoming-chat` events via `useVdoNinjaChat`.

**WARNING documented for future contributors:** We only receive chat in the producer panel. We never call `sendChat()` from the producer side. The producer's chat iframe has `label: "Producer"` but no `push` stream ID — VDO.Ninja may assign a default. This is fine since we're read-only.

### 4.2 Chat Message Buffer Section

New section in ProducerRoute, positioned between "Host tracker" and "Activity feed":

**Title:** "Chat to screen"

**Contents:**
- Scrollable list of recent chat messages (max 50, `ChatMessage` type from vdoninjaChat)
- Each message row:
  - Sender label (colored cyan for remote)
  - Message text (truncated to 2 lines with ellipsis)
  - "Feature" button per message
  - Relative timestamp
- "Clear from screen" button at the bottom
- Auto-scroll to bottom (same pattern as ChatRoute's ChatFeed)

### 4.3 State

```typescript
const [chatMessages, setChatMessages] = useState<readonly ChatMessage[]>([]);

// ID counter for chat message React keys (same pattern as ChatRoute)
const chatIdRef = useRef(0);
const nextChatId = () => `c${chatIdRef.current++}`;
```

No `featuredMessage` state needed on the producer side — the activity feed entry is sufficient confirmation. The "Feature" button can be highlighted via CSS active state if needed, but tracking which message is currently on screen is not required for MVP.

### 4.4 Chat Incoming Handler

```typescript
const onChatIncoming = useCallback(
  (msg: { msg: string; label: string; ts: number }) => {
    setChatMessages((prev) =>
      [...prev, { id: nextChatId(), source: "remote", ...msg }].slice(-50),
    );
  },
  [],
);
```

- No `isOwnLabel` filtering — the producer needs to see ALL messages, including their own if any slip through.
- All messages are `source: "remote"` since the producer never sends chat.

### 4.5 Feature Flow

1. Producer clicks "Feature" on a chat message
2. Sanitize the message: strip control characters (see S6.3)
3. Call `send({ type: "chatToScreen", author: msg.label, message: sanitizedMsg, ts: Date.now() })`
4. Activity feed logs: `Featured: "${truncated}" — ${msg.label}`
5. The button briefly highlights for visual feedback

### 4.6 Clear Flow

1. Producer clicks "Clear from screen"
2. `send({ type: "chatToScreenClear", ts: Date.now() })`
3. Activity feed logs: "Cleared chat from screen"

### 4.7 `formatEvent` Update

**Audit finding G-2:** The existing `formatEvent` switch has a `default: return null`. After adding the new event types, add cases:

```typescript
case "chatToScreen":
  return `Chat featured: ${msg.author}`;
case "chatToScreenClear":
  return "Chat cleared from screen";
```

This handles the loopback path (when the producer's own `sendData` echoes back through the codirector data channel). The imperative `setFeed` calls in the click handlers provide immediate confirmation; `formatEvent` handles the echo.

### 4.8 Message Sanitization (pre-send)

**Audit finding E6 (control characters):** Before sending, strip control characters and zero-width characters:

```typescript
function sanitizeForOverlay(text: string): string {
  return text
    // Strip C0 control chars except tab/newline/carriage-return
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    // Strip zero-width chars (ZWSP, ZWNJ, ZWJ, BOM)
    .replace(/[\u200B-\u200F\uFEFF]/g, "")
    // Collapse multiple spaces/newlines to single space
    .replace(/\s+/g, " ")
    .trim();
}
```

---

## 5. Overlay Route Changes

### 5.1 State

```typescript
interface ChatScreenSprite {
  id: string;
  author: string;
  message: string;
  /** Timestamp after which the sprite auto-dismisses. */
  expiresAt: number;
}

const [chatScreenSprite, setChatScreenSprite] = useState<ChatScreenSprite | null>(null);
```

Single message at a time. New featured message replaces the current one (same pattern as `cardAnnounce`).

### 5.2 Auto-dismiss

**Duration:** 15 seconds (`CHAT_SCREEN_MS = 15_000`). (Aria review: 20s was too long for a fast-paced show; 15s is enough to read 2-3 times.)

The sprite is stamped with `expiresAt: Date.now() + CHAT_SCREEN_MS + 80` (80ms grace margin, matching existing sprite convention so the CSS animation finishes before removal).

**Manual clear** (`chatToScreenClear` event) removes immediately via `setChatScreenSprite(null)` — not gated by the sweep interval. Clear latency is just the P2P round-trip, typically <50ms.

### 5.3 onMessage Handler

Add to the switch:

```typescript
case "chatToScreen":
  setChatScreenSprite({
    id: nextId(),
    author: msg.author,
    message: msg.message,
    expiresAt: Date.now() + CHAT_SCREEN_MS + 80,
  });
  break;
case "chatToScreenClear":
  setChatScreenSprite(null);
  break;
```

Add to the sweep interval:

```typescript
// Existing sweep prunes emoji/card/aura sprites by expiresAt.
// Chat screen sprite is single-slot — use functional setter to avoid
// stale closure (the sweep effect captures state at mount time).
// Matches the pattern used by setEmojiSprites/setCardSprites above.
setChatScreenSprite((prev) => (prev && prev.expiresAt <= now ? null : prev));
```

### 5.4 Rendering — `ChatScreenCard` Component

**Position:** Center-bottom. `bottom: 160px` to clear OBS lower-thirds and bottom-row tiles. (Aria review: raised from 120px for more clearance.) `left: 50%`, `transform: translateX(-50%)`. Max-width: 720px (Aria review: narrowed from 800px to keep it a quote card, not a paragraph block).

**Z-index:** `zIndex: 60` — below `CardAnnounceText` (zIndex: 100) and above tile-based sprites (no zIndex = auto).

**Pointer events:** `pointerEvents: "none"` — matches the existing non-interactive overlay convention.

**`willChange: "opacity, transform"`** — compositor hint matching existing sprite convention (StfuCard, MicDropCard use this pattern).

**No `backdropFilter`** — audit finding E1/G-1 confirmed `backdrop-filter: blur()` is a no-op on OBS CEF browser sources (nothing behind the element in the same stacking context to blur). The overlay root is transparent. Use opaque `rgba(10,6,16,0.92)` background instead.

#### Style Specification

```typescript
const CHAT_SCREEN_MS = 20_000;

const ChatScreenCard = React.memo(function ChatScreenCard({ sprite }: { sprite: ChatScreenSprite }) {
  // Grapheme-aware truncation (audit finding E3)
  const graphemes = Array.from(sprite.message);
  const display = graphemes.length > 200
    ? graphemes.slice(0, 200).join("") + "\u2026" // ellipsis
    : sprite.message;

  return (
    <div style={{
      position: "absolute",
      left: "50%",
      bottom: 160, // Aria: raised from 120 for OBS lower-third clearance
      transform: "translateX(-50%)",
      maxWidth: 720, // Aria: narrowed from 800 to keep quote-card proportions
      zIndex: 60,
      pointerEvents: "none",
      willChange: "opacity, transform",
      padding: "16px 24px",
      borderRadius: 12,
      background: "rgba(10,6,16,0.92)",
      border: "1px solid rgba(255,46,159,0.6)", // Aria: raised from 0.4
      boxShadow: "0 0 30px rgba(255,46,159,0.15), 0 8px 24px rgba(0,0,0,0.6)",
      // Single keyframe over full lifetime (entrance + hold + exit).
      // Matches CardAnnounceText pattern. See §5.5 / §13 for keyframe definition.
      // Aria review: cubic-bezier overshoot for entrance, 15s duration.
      animation: "chatScreenSlide 15000ms cubic-bezier(0.2,1.5,0.4,1) forwards",
    }}>
      <div style={{
        fontFamily: '"Inter", system-ui, sans-serif',
        fontWeight: 800,
        fontSize: 13,
        letterSpacing: 1,
        color: "#22e2ff", // cyan, matching existing chat label color
        textTransform: "uppercase",
        marginBottom: 4,
      }}>
        {sprite.author}
      </div>
      <div style={{
        // Emoji-safe font stack (audit finding E4)
        // Aria: fontWeight 700 (raised from 600), fontSize 30 (raised from 26)
        // Aria: NO textTransform — mixed case preserves guest voice
        fontFamily: '"Inter", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", system-ui, sans-serif',
        fontWeight: 700,
        fontSize: 30,
        color: "#f0f0f8",
        lineHeight: 1.3,
        wordBreak: "break-word",
      }}>
        {display}
      </div>
    </div>
  );
});
```

### 5.5 CSS Keyframes

Single keyframe that handles entrance AND exit (matching the `CardAnnounceText` pattern — one keyframe over the full lifetime, ending at opacity: 0 for a fade-out exit). This addresses audit finding E2/I-7:

```css
/* Chat message card entrance + hold + exit.
   Total duration: CHAT_SCREEN_MS (15000ms).
   Entrance: 0-2% (0-300ms) — overshoot pop with slide up.
   Hold: 2%-93% (300ms-14s) — visible.
   Exit: 93%-100% (14s-15s) — fade out.
   Aria review: 15s duration, cubic-bezier overshoot entrance. */
@keyframes chatScreenSlide {
  0% {
    opacity: 0;
    transform: translateX(-50%) translateY(20px) scale(0.95);
  }
  2% {  /* ~300ms of 15s */
    opacity: 1;
    transform: translateX(-50%) translateY(0) scale(1);
  }
  93% { /* ~14s */
    opacity: 1;
    transform: translateX(-50%) translateY(0) scale(1);
  }
  100% {
    opacity: 0;
    transform: translateX(-50%) translateY(8px) scale(0.98);
  }
}
```

Applied as: `animation: "chatScreenSlide 15000ms cubic-bezier(0.2,1.5,0.4,1) forwards"`

**Note on rapid replacement:** When the producer features message B while A is on screen, React unmounts A and mounts B with a fresh key. B's animation starts from 0% (entrance). A's mid-animation exit is skipped — it just disappears. This is consistent with the existing `CardAnnounceText` behavior and is actually *forgiving* for "oops, undo" scenarios (audit finding OP-6).

**Clear event behavior:** When `chatToScreenClear` fires, `setChatScreenSprite(null)` unmounts the card immediately. There's no exit animation on clear — the card snaps off. This is intentional: the producer wants it gone NOW, not in 400ms. The sweep interval's 80ms grace doesn't apply here because clear is a direct `null` set, not an `expiresAt` timeout.

If a softer exit is desired later, a `chatScreenOut` class could be added and the sweep deferred, but MVP ships with snap-clear.

### 5.6 Render Placement in JSX

`ChatScreenCard` renders AFTER emoji/card/aura sprites and STFU overlays, but BEFORE `CardAnnounceText` and the debug HUD. This ensures:
- Above: emoji floats, card sprites, source auras, MutedTileOverlay (all zIndex auto or lower)
- Below: card announcements (zIndex 100)

```typescript
{/* ... existing sprites ... */}
{muteReasons.size > 0 && /* ... MutedTileOverlay ... */}
{chatScreenSprite && <ChatScreenCard key={chatScreenSprite.id} sprite={chatScreenSprite} />}
{cardAnnounce && /* ... CardAnnounceText ... */}  // zIndex: 100
{calibrateMode && /* ... CalibrationGrid ... */}
{debugMode && /* ... DebugHUD ... */}
```

---

## 6. Security / Safety

### 6.1 XSS Prevention
- Message text is HTML-stripped by `parseChatBody` in vdoninjaChat.ts (DOMParser + textContent, drops script/style)
- React renders as text nodes (no `dangerouslySetInnerHTML`)
- Author field is also plain text from VDO.Ninja's label system
- Control chars + zero-width chars stripped pre-send (S4.8)

### 6.2 Message Length
- `validatePayload`: no length check (structural-only, per existing contract)
- `ChatScreenCard` render: grapheme-aware truncation at 200 graphemes with ellipsis (audit finding E3)

### 6.3 Guest Forge Risk — ACKNOWLEDGED, ACCEPTED

**Audit finding I-2 (HIGH):** The P2P data channel is broadcast. Any peer in the room with the room password (shipped in the client bundle) can post `chatToScreen` events by running `sendData` directly. The producer is the only one with UI to do this — that's ergonomics, not protocol authorization.

**MVP scope:** Accepted. The room password is already in the bundle for all other events (cards, roster, tracker). A guest who wants to forge a `chatToScreen` event can already forge `cardPlay`, `rosterUpdate`, or `trackerUpdate` events. This feature adds no new attack surface beyond what already exists. Mitigation would require sender authentication that doesn't exist in the current architecture.

If this becomes a real problem, the overlay could validate event origin via VDO.Ninja's sender UUID metadata, but that requires widening `onData`'s callback signature — out of scope for MVP.

### 6.4 Content Moderation
- Producer manually selects messages to feature — implicit moderation
- No automated filtering needed for MVP

---

## 7. Files to Modify

| File | Changes |
|------|---------|
| `src/lib/vdoninja.ts` | Add `ChatToScreenEvent` + `ChatToScreenClearEvent` interfaces, add to `EventPayload` union, add to `VALID_TYPES`, add validation in `validatePayload` |
| `src/lib/vdoninjaChat.ts` | Add Shape C (`gotChat`) handler in `onChat` — pre-existing gap found via VDO.Ninja docs cross-reference (§12.1) |
| `src/routes/ProducerRoute.tsx` | Add second hidden chat iframe + `useVdoNinjaChat`, `chatMessages` state, `sanitizeForOverlay`, "Chat to screen" Section with message list + feature/clear buttons, `formatEvent` cases, activity feed entries |
| `src/routes/OverlayRoute.tsx` | Add `CHAT_SCREEN_MS` const, `chatScreenSprite` state, onMessage cases, sweep cleanup, `ChatScreenCard` component, render in JSX at correct z-order position |
| `src/index.css` | Add `chatScreenSlide` keyframe (20s entrance + hold + exit) |

**No new files.** Everything fits into the existing architecture.

---

## 8. Implementation Order

1. **Event types** (`vdoninja.ts`): Add interfaces, union member, VALID_TYPES, validation. Run `tsc -b` to verify types compile.
2. **CSS keyframe** (`index.css`): Add `chatScreenSlide`. No code dependency.
3. **Overlay rendering** (`OverlayRoute.tsx`): Add state, onMessage handler, sweep cleanup, `ChatScreenCard` component, render in JSX. Test: send a raw `chatToScreen` event from dev console to verify rendering.
4. **Producer panel** (`ProducerRoute.tsx`): Add chat iframe, `useVdoNinjaChat`, chat message buffer, "Chat to screen" section UI, feature/clear handlers, `formatEvent` cases.
5. **Build + verify**: `npm run build` passes, test end-to-end with two browser tabs.
6. **Test in OBS**: Load overlay as browser source, verify rendering against actual camera composet.

---

## 9. Edge Cases

| Edge Case | Handling | Severity |
|-----------|----------|----------|
| Producer features a message, then another quickly | Second replaces first. New card mounts fresh with entrance animation. No queue. | Resolved |
| Message has emoji in it | Renders correctly — font stack includes Apple/Segoe/Noto Color Emoji fallback | Resolved (E4) |
| Very long message (500+ chars) | Grapheme-aware truncation at 200 graphemes with ellipsis. `Array.from()` prevents splitting surrogate pairs. | Resolved (E3) |
| Message has control chars / zero-width chars | Stripped pre-send by `sanitizeForOverlay` | Resolved (E6) |
| Empty message | Rejected in `validatePayload` (`p.message.trim() === ""` returns null) | Resolved |
| Overlay refreshes mid-feature | Message is gone (not persisted). Same as card announcements. Accepted. | Accepted (FM-1) |
| Producer refreshes mid-feature | Chat buffer is lost (not persisted). Same as buzz board. Accepted. | Accepted (FM-2) |
| Data channel drops mid-feature | Message auto-dismisses in 20s via sweep. Producer's Clear button no-ops during disconnect. | Accepted (FM-1) |
| `backdropFilter: blur(8px)` | Removed. No-op on OBS CEF. Using opaque background instead. | Resolved (E1) |
| STFU slam text overlaps chat card | zIndex hierarchy: chat card (60) above tile sprites (auto), below card announce (100) | Resolved (OP-3) |
| Bottom-row SILENCED label overlap | Same z-order resolution | Resolved |
| Rapid clear-then-feature | React 18 batching coalesces. New card replaces without flash of empty. | Resolved (OP-6) |
| RTL text | No explicit `direction` CSS. CEF's default bidi algorithm handles it. Acceptable for MVP. | Accepted (E5) |
| Guest forges chatToScreen event | Accepted as MVP scope (same risk as all other events) | Accepted (I-2) |
| Multiple producers | Last-write-wins via `ts`. Acceptable parity with card announcements. | Accepted (E9) |
| `uppercase` on RTL scripts | N/A — message body is now mixed case (Aria review). Author label stays uppercase but is short and Latin. | Resolved (E8) |

---

## 10. Audit Findings Resolution Summary

### From Architecture Audit (Pass 1)

| Finding | Severity | Resolution |
|---------|----------|------------|
| I-1: Codirector iframe can't receive chat | HIGH | S2.3: Second hidden iframe using `buildChatOnlyUrl` |
| I-2: Guest forge risk | HIGH | S6.3: Acknowledged, accepted as MVP scope |
| I-3: Length cap in validatePayload | MEDIUM | S3.4: Moved to render side, validatePayload stays structural |
| I-4: Bottom-center positioning overlaps | MEDIUM | S5.4: Moved to `bottom: 120px` |
| I-5: No zIndex | LOW | S5.4: Added `zIndex: 60` |
| I-6: Seat field dead | LOW | S3.1: Removed `seat` from event |
| I-7: No exit animation | LOW | S5.5: Single keyframe with exit phase (like CardAnnounceText) |
| G-1: backdropFilter no-op | MEDIUM | S5.4: Removed |
| G-2: formatEvent not updated | LOW | S4.7: Added cases |
| G-3: CHAT_SCREEN_MS undeclared | LOW | S5.2: Declared as const |
| G-4: Producer label filtering | LOW | S4.4: Documented "receive only" |
| G-5: Rapid click race | LOW | S4.5: Last-wins documented |
| G-6: willChange missing | LOW | S5.4: Added `willChange: "opacity, transform"` |
| G-7: local/remote source | LOW | S4.4: All remote, documented |
| G-8: Inline styles vs CSS | LOW | S5.4: Inline styles in component, keyframe in CSS |
| G-9: STFU slam overlap | MEDIUM | S5.6: z-order + JSX placement |
| G-10: pointerEvents | LOW | S5.4: Added `pointerEvents: "none"` |

### From Final Audit (Pass 3 — Implementation Detail Review)

| Finding | Severity | Resolution |
|---------|----------|------------|
| Blocker A: Stale closure in sweep cleanup | HIGH | §5.3: Changed to functional setter `setChatScreenSprite((prev) => ...)` |
| Blocker B: Animation name/duration mismatch | HIGH | §5.4: Reconciled to `chatScreenSlide 20000ms ease-in-out forwards` |
| Blocker C: Missing `key` prop in JSX | HIGH | §5.6: Added `key={chatScreenSprite.id}` |
| Minor: `nextChatId` not declared | LOW | §4.3: Added declaration |


| Finding | Severity | Resolution |
|---------|----------|------------|
| E1: backdropFilter no-op | HIGH | S5.4: Removed (same as G-1) |
| E2: No exit animation | HIGH | S5.5: Single keyframe with exit phase |
| E3: Truncation splits surrogates | HIGH | S5.4: `Array.from()` grapheme-aware truncation |
| E4: Emoji font stack missing | MEDIUM | S5.4: Added emoji fallback chain |
| E5: RTL handling | MEDIUM | S9: Accepted for MVP |
| E6: Control chars passthrough | MEDIUM | S4.8: `sanitizeForOverlay` pre-send |
| E7: Animation remount stutter | LOW | S9: Consistent with existing card announce pattern |
| E8: uppercase on RTL | LOW | S9: Accepted |
| E9: Multi-producer clock | LOW | S9: Last-write-wins, accepted |
| E10: Author unbounded | LOW | Minor, render-side truncation handles visually |
| FM-1: Data channel drops | MEDIUM | S9: Auto-dismiss via sweep (20s) |
| FM-2: Producer iframe reloads | MEDIUM | S9: State in parent survives, chat history hole accepted |
| FM-3: Overlay refresh | MEDIUM | S9: No sync event, accepted (same as card announcements) |
| OP-3: Z-order with STFU | MEDIUM-HIGH | S5.4/S5.6: zIndex 60, JSX placement |
| OP-4: Scale (200 msgs) | MEDIUM | S4.2: 50-item cap, <5ms renders |

---

## 12. VDO.Ninja Documentation Cross-Reference

> Every transport assumption in this plan was verified against the official VDO.Ninja IFRAME API docs (https://docs.vdo.ninja/guides/iframe-api-documentation) and the source code (main.js on the develop branch).

### 12.1 Chat Event Formats — THREE Shapes in the Wild

VDO.Ninja has shipped chat events in multiple formats across versions. Our `vdoninjaChat.ts` already handles two:

| Shape | Event structure | Source | Handled? |
|-------|----------------|--------|----------|
| A | `{ action: "incoming-chat", value: { msg, label, ts? } }` | Our codebase (vdoninjaChat.ts:159) | Yes |
| B | `{ chat: { msg, type, time } }` | main.js source comment (line ~303538) | Yes (Shape B handler at line 183) |
| C | `{ gotChat: { msg: "..." } }` | Official docs (iframe-api-basics page) | **NO — missing** |

**Action item:** Add Shape C (`gotChat`) to `vdoninjaChat.ts`'s `onChat` handler. This is a pre-existing gap, not introduced by this feature, but the producer's chat iframe will be the first time we rely on chat reception outside of ChatRoute/PlayRoute. If VDO.Ninja emits `gotChat` instead of `incoming-chat`, the producer would see zero messages.

```typescript
// Shape C: { gotChat: { msg, ... } } — from official VDO.Ninja docs
if ("gotChat" in data) {
  const gotChat = data["gotChat"] as Record<string, unknown>;
  const rawMsg = typeof gotChat?.["msg"] === "string" ? gotChat["msg"] as string : null;
  const sidecarLabel = typeof gotChat?.["label"] === "string" ? gotChat["label"] as string : "";
  if (rawMsg) emit(rawMsg, sidecarLabel, callback);
  return;
}
```

### 12.2 `dataonly` Parameter Behavior

From the docs:
- `&dataonly` — "Configures for data-only apps (no camera/mic controls)"
- `&novideo` + `&noaudio` — "Useful for directors who may wish to only issue commands or text chat, but..."
- `&datamode` — "Combines a bunch of flags together; no video, no audio, GUI, etc."

**Assessment:** The docs suggest `dataonly`/`novideo`+`noaudio` connections CAN participate in text chat. However, there is no explicit confirmation that `postMessage` chat events (`incoming-chat` / `gotChat` / `chat`) are emitted to the parent from a `dataonly` codirector iframe. The codirector topology (`&codirector=...&dataonly`) is a different connection mode than a regular room join.

**Plan decision remains: second hidden iframe using `buildChatOnlyUrl`.** This is the proven topology — both ChatRoute and PlayRoute use regular room joins (not dataonly) for chat. The second iframe is cheap (no camera/mic, minimal bandwidth) and guarantees we get chat events.

### 12.3 `sendChat` Command Format

The docs show two ways to send chat from parent to iframe:
1. **Direct postMessage:** `{ sendChat: "Hello!" }` — our codebase uses this (vdoninjaChat.ts:120)
2. **Director action:** `{ action: "sendChat", value: "Hello everyone!" }` — with optional `target` for private messages to specific guests

We only receive chat (producer doesn't send), so this is informational.

### 12.4 `sendDirectorChat` — VDO.Ninja's Built-in "Chat to Screen"

The director API has `{ action: "sendDirectorChat", target: "2", value: "You're live!" }` which overlays a message on a guest's VDO.Ninja UI. This is VDO.Ninja's own version of "chat to screen" but:
- It goes to the **guest's VDO.Ninja interface**, not our OBS overlay
- It's a director-to-guest notification, not an audience-facing graphic
- It doesn't use our neon styling or positioning

**Not suitable for our use case.** We need audience-facing overlay graphics, not guest notifications. Our P2P `sendData` approach with custom rendering in the overlay route is correct.

### 12.5 P2P Data Channel (`sendData`) Confirmed

From the docs (Generic P2P Data Transmission Guide):
- `sendData: { yourAppName: data }` — namespaced payload (we use `overlayNinja`)
- `type: "pcs"` — reliable broadcast to all peers
- `UUID` optional for targeting specific peers
- `dataReceived` event inbound: `e.data.dataReceived.yourAppName`

Our codebase follows this exactly. The `chatToScreen` event will ride this same channel with no issues.

### 12.6 Director / Codirector Parameters

From the Director Parameters docs:
- `&director=roomname` — enters as director with full control
- `&codirector=password` — assistant director with subset of control
- `&dataonly` — can be combined with codirector for data-only director connection

Our producer's overlay iframe uses `&codirector=gamifiedadmin&password=gaming&dataonly` — this is a data-only codirector that can broadcast `sendData` to all peers but doesn't handle video/audio. This is correct for the P2P event channel.

The new chat iframe will use a regular room join (`&room=...&hash=...&password=...`) without `codirector` or `dataonly` — matching `buildChatOnlyUrl`'s existing design.

### 12.7 Source Verification

Cross-referenced against:
- https://docs.vdo.ninja/guides/iframe-api-documentation (main API docs)
- https://docs.vdo.ninja/guides/iframe-api-documentation/iframe-api-basics (event listener setup, `gotChat` reference)
- https://docs.vdo.ninja/guides/iframe-api-documentation/iframe-api-for-directors (director commands, `sendDirectorChat`)
- https://docs.vdo.ninja/guides/iframe-api-documentation/generic-p2p-data-transmission-guide (`sendData` / `dataReceived` patterns)
- https://docs.vdo.ninja/guides/iframe-api-documentation/create-custom-drawing-app (`overlayNinja` namespace pattern)
- https://docs.vdo.ninja/advanced-settings/director-parameters (`codirector`, `dataonly`)
- https://docs.vdo.ninja/advanced-settings/setup-parameters/and-datamode (`datamode` / `dataonly` behavior)
- https://docs.vdo.ninja/advanced-settings/video-parameters/and-novideo (`novideo` + `noaudio` for text-chat-only directors)
- https://docs.vdo.ninja/guides/how-does-group-chat-work (chat is P2P, end-to-end encrypted, available to room participants)
- https://github.com/steveseguin/vdo.ninja/blob/develop/main.js (source code — `sendChat` handler at ~303390, chat postMessage comment at ~303538)
- https://github.com/steveseguin/Companion-Ninja/blob/main/iframeapi.md (complete API reference)

---

## 13. Design Decisions (Aria-Reviewed)

Based on Aria's design review of the mockups and the existing overlay design:

### Applied Changes from Aria's Review

1. **Message text: mixed case, NOT uppercase.** The show uses uppercase for brand/UI labels (card announcements, SILENCED) but chat messages are the guests' voice. Forcing uppercase flattens personality, shifts comedic tone to shouting, and inflates width ~15-20%. Keep uppercase on the author *label* only. Bump font-weight from 600 to 700 to compensate for the lost uppercase weight.

2. **Position: `bottom: 160px`** (was 120px). Gives 100px clearance from OBS lower-thirds/logos that typically live at the canvas bottom.

3. **Max-width: `720px`** (was 800px). Keeps it a "quote card" not a paragraph block. 800px allowed 200-grapheme messages to become 4-5 line walls.

4. **Duration: `15s`** (was 20s). 20s is 3x longer than a card announcement (6s) and feels stale on a fast-paced show. 15s is enough to read a long message 2-3 times. Update `CHAT_SCREEN_MS = 15_000`.

5. **Font size: `30px`** (was 26px). 26px is marginal after OBS compositing + YouTube compression. CardAnnounceText uses 32px; chat messages deserve comparable mass.

6. **Entrance curve: `cubic-bezier(0.2, 1.5, 0.4, 1)`** (was `ease-in-out`). Matches CardAnnounceText's overshoot pop. Applied to the entrance phase only; hold and exit stay smooth.

7. **Border opacity: `0.6`** (was 0.4). Stronger pink presence without being overpowering.

### Approved (No Changes)

- Z-index stack (60 below card announce's 100, above tile sprites)
- Cyan author label + white message body + pink border color scheme
- Single-keyframe animation architecture (entrance + hold + exit in one keyframe)
- Snap-clear on manual clear (no exit animation — producer wants it gone NOW)
- No watermark, no timestamp, no "LIVE CHAT" badge, no sender avatar
- Inter font for readability
- Opaque background (no backdrop-filter — confirmed no-op on OBS CEF)
- Grapheme-aware truncation at 200 graphemes
- Producer panel "Chat to screen" section design

### Final Style Specification (Updated)

```typescript
const CHAT_SCREEN_MS = 15_000;

// Container
{
  position: "absolute",
  left: "50%",
  bottom: 160,          // raised from 120 (Aria)
  transform: "translateX(-50%)",
  maxWidth: 720,        // narrowed from 800 (Aria)
  zIndex: 60,
  pointerEvents: "none",
  willChange: "opacity, transform",
  padding: "16px 24px",
  borderRadius: 12,
  background: "rgba(10,6,16,0.92)",
  border: "1px solid rgba(255,46,159,0.6)",  // opacity raised from 0.4 (Aria)
  boxShadow: "0 0 30px rgba(255,46,159,0.15), 0 8px 24px rgba(0,0,0,0.6)",
  animation: "chatScreenSlide 15000ms cubic-bezier(0.2,1.5,0.4,1) forwards",
}

// Author label
{
  fontFamily: '"Inter", system-ui, sans-serif',
  fontWeight: 800,
  fontSize: 13,
  letterSpacing: 1,
  color: "#22e2ff",
  textTransform: "uppercase",  // uppercase stays on author only
  marginBottom: 4,
}

// Message text
{
  fontFamily: '"Inter", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", system-ui, sans-serif',
  fontWeight: 700,  // raised from 600 to compensate for mixed case (Aria)
  fontSize: 30,     // raised from 26 (Aria)
  color: "#f0f0f8",
  lineHeight: 1.3,
  wordBreak: "break-word",
  // NO textTransform — mixed case preserves the guest's voice (Aria)
}
```

### Updated CSS Keyframe

```css
/* Chat message card entrance + hold + exit.
   Total duration: 15s (CHAT_SCREEN_MS).
   Entrance: 0-2% (0-300ms) — overshoot pop with slide up.
   Hold: 2%-93% (300ms-14s) — visible.
   Exit: 93%-100% (14s-15s) — fade out. */
@keyframes chatScreenSlide {
  0% {
    opacity: 0;
    transform: translateX(-50%) translateY(20px) scale(0.95);
  }
  2% {
    opacity: 1;
    transform: translateX(-50%) translateY(0) scale(1);
  }
  93% {
    opacity: 1;
    transform: translateX(-50%) translateY(0) scale(1);
  }
  100% {
    opacity: 0;
    transform: translateX(-50%) translateY(8px) scale(0.98);
  }
}
```

**Note on easing:** The `cubic-bezier(0.2,1.5,0.4,1)` overshoot applies to the entrance phase. The keyframe percentages map to 15s duration: 2% = 300ms entrance, 93% = 14s hold end, 100% = 15s exit end.

---

## 12. Testing Checklist

- [ ] `tsc -b` passes with new event types
- [ ] `npm run build` passes clean
- [ ] Producer sees chat messages arriving in real-time (via second iframe)
- [ ] Feature button sends event to overlay
- [ ] Overlay renders message with correct styling
- [ ] Entrance animation plays (slide up + fade in)
- [ ] Exit animation plays at 20s (fade out)
- [ ] Manual clear removes instantly (snap-off)
- [ ] Rapid successive features replace correctly (no queue, no stutter)
- [ ] Long messages truncate at 200 graphemes (no broken emoji)
- [ ] HTML in messages is stripped (parseChatBody)
- [ ] Control chars stripped (sanitizeForOverlay)
- [ ] Emoji in messages render correctly on OBS CEF
- [ ] Z-order: chat card above tile sprites, below card announcements
- [ ] Z-order: no conflict with STFU SILENCED overlay on bottom-row tiles
- [ ] No console errors in overlay or producer
- [ ] OBS browser source renders correctly (not just browser dev tools)
- [ ] Activity feed logs feature/clear events
- [ ] `formatEvent` handles loopback echoes
