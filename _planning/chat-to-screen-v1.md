# Chat-to-Screen Feature — Implementation Plan v1

## 1. Feature Summary

Allow the producer to select chat messages from the VDO.Ninja chat feed and push them to the OBS overlay as styled on-screen text graphics. The audience sees the selected message rendered with Gamified's neon aesthetic, attributed to the sender.

**Core flow:** Producer sees chat messages arriving in the producer panel → clicks one to feature it → message appears on the overlay → auto-dismisses after a timeout or producer clears it.

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
| Play route | Guest/host wrapper | `src/routes/PlayRoute.tsx` | Cards, buzzers, tracker display, emoji |

### 2.2 Transport Decision: Which channel for featured messages?

**Decision: P2P data channel (`sendData`), NOT VDO.Ninja chat.**

Rationale:
- The overlay listens on the P2P data channel (`useVdoNinja({ onMessage })`). It does NOT listen to VDO.Ninja chat events.
- Adding chat event handling to the overlay would require coupling the overlay to `useVdoNinjaChat`, which is a different transport and adds complexity.
- The P2P channel is already battle-tested for producer-to-overlay events (rosterUpdate, trackerUpdate, calibration, cardReset).
- Chat messages are small strings. No bandwidth concern.
- The producer already has a `send()` function on the P2P channel.

**The chat itself stays on VDO.Ninja's websocket chat** — we don't change how chat works. We only add the ability for the producer to "feature" a message by sending a new event type on the P2P channel.

---

## 3. Event Design

### 3.1 New Event Type: `chatToScreen`

```typescript
export interface ChatToScreenEvent {
  type: "chatToScreen";
  /** Display name of the chat sender (from VDO.Ninja label). */
  author: string;
  /** The message text to display. Plain text, HTML already stripped. */
  message: string;
  /** Optional: seat if the sender is a known guest (for tile-based positioning). */
  seat?: SeatId;
  /** Wall-clock timestamp (ms). */
  ts: number;
}
```

Added to `EventPayload` union and `VALID_TYPES` set.

Validation in `validatePayload`:
- `author` must be a non-empty string
- `message` must be a non-empty string (reject empty whitespace)
- `seat` if present must be a valid SeatId
- Enforce max message length (see §5.4)

### 3.2 Clear Event: `chatToScreenClear`

```typescript
export interface ChatToScreenClearEvent {
  type: "chatToScreenClear";
  ts: number;
}
```

Producer sends this to remove the current featured message immediately.

---

## 4. Producer Panel Changes

### 4.1 Chat Message Queue Section

New section in ProducerRoute between "Activity feed" and "Calibration":

**Title:** "Chat to screen"

**Contents:**
- A scrollable list of recent chat messages (same `ChatMessage` type from vdoninjaChat)
- Each message row has:
  - Sender label (colored cyan for remote, pink for local)
  - Message text (truncated to 2 lines)
  - "Feature" button on each message
  - Timestamp
- "Clear from screen" button (removes current featured message)
- Auto-scroll to bottom (same pattern as ChatRoute's ChatFeed)

**Chat message source:** The producer panel needs to join the VDO.Ninja chat to receive messages. It already has a `useVdoNinja()` iframe (data-only codirector). We add `useVdoNinjaChat()` to the same iframe to also receive chat events.

**Key implementation detail:** The producer's iframe is already a codirector (`buildOverlayDataOnlyUrl`). VDO.Ninja chat works over the room websocket, which the codirector already has. So `sendChat`/`onChat` should work on the same iframe without a separate chat-only URL.

### 4.2 State

```typescript
const [chatMessages, setChatMessages] = useState<readonly ChatMessage[]>([]);
const [featuredMessage, setFeaturedMessage] = useState<ChatMessage | null>(null);
```

- `chatMessages`: rolling buffer of recent chat messages (cap at ~50)
- `featuredMessage`: currently featured message (for UI state + highlight)

### 4.3 Feature Flow

1. Producer clicks "Feature" on a chat message
2. Producer calls `send({ type: "chatToScreen", author: msg.label, message: msg.msg, ts: Date.now() })`
3. Activity feed logs: `Featured: "${truncated msg}" — ${author}`
4. `setFeaturedMessage(msg)` for UI highlight
5. Optional: auto-clear after timeout (see §5.2)

### 4.4 Clear Flow

1. Producer clicks "Clear from screen"
2. `send({ type: "chatToScreenClear", ts: Date.now() })`
3. Activity feed logs: "Cleared chat from screen"
4. `setFeaturedMessage(null)`

### 4.5 Message Buffer Management

- Cap at 50 messages (FEED_CAP pattern from existing activity feed)
- New messages append to bottom, old messages trimmed from top
- No filtering of own messages — producer needs to see all messages including their own
- Messages are purely from VDO.Ninja chat incoming events

---

## 5. Overlay Route Changes

### 5.1 State

```typescript
interface ChatScreenSprite {
  id: string;
  author: string;
  message: string;
  seat?: SeatId;
  /** Timestamp after which the sprite auto-dismisses. */
  expiresAt: number;
}

const [chatScreenSprite, setChatScreenSprite] = useState<ChatScreenSprite | null>(null);
```

Single message at a time (not a queue). New featured message replaces the current one.

### 5.2 Auto-dismiss

Two options:

**Option A: Auto-dismiss after N seconds (recommended)**
- Default: 15 seconds
- Producer can send another message to replace, or clear manually
- Timer is reset when a new message arrives (replaces the old one)
- Matches the pattern of card announcements (which auto-dismiss after 6s)

**Option B: Manual dismiss only**
- Message stays until producer clears it
- Simpler, but risks stale messages lingering if producer forgets

**Recommendation: Option A with a generous timer (20s).** Producer can always clear early. This prevents "stale message on screen" if the producer gets distracted.

### 5.3 onMessage Handler

Add to the switch in `onMessage`:

```typescript
case "chatToScreen":
  setChatScreenSprite({
    id: nextId(),
    author: msg.author,
    message: msg.message,
    seat: msg.seat,
    expiresAt: Date.now() + CHAT_SCREEN_MS + 80,
  });
  break;
case "chatToScreenClear":
  setChatScreenSprite(null);
  break;
```

Also add `chatScreenSprite` to the sweep interval cleanup:

```typescript
setChatScreenSprite((prev) =>
  prev && prev.expiresAt > now ? prev : null
);
```

### 5.4 Rendering

New component: `ChatScreenCard`

**Position:** Center-bottom of canvas, above the bottom camera tiles. Avoids overlapping with:
- Card announcements (center screen)
- Emoji floats (tile-based, rise upward)
- STFU overlay (tile-based)
- Tracker (host sidebar)

**Layout:**
- Semi-transparent dark panel with neon border
- Author name in cyan/pink (matching chat route colors)
- Message text in white, Orbitron or Inter
- Subtle entrance animation (fade + slide up)
- Exit animation (fade out)

**Dimensions:**
- Max width: 800px (centered)
- Max height: ~120px
- Positioned at bottom center: `left: 50%, bottom: ~60px`
- Transform: `translateX(-50%)`

**Text constraints:**
- Max 200 characters displayed (truncate with ellipsis)
- Word break to prevent overflow
- Font size: 24-28px for readability on stream

**Style mock (inline, matching existing NEON palette):**
```typescript
// Container
{
  position: "absolute",
  left: "50%",
  bottom: 60,
  transform: "translateX(-50%)",
  maxWidth: 800,
  padding: "16px 24px",
  borderRadius: 12,
  background: "rgba(10,6,16,0.92)",
  border: "1px solid rgba(255,46,159,0.4)",
  boxShadow: "0 0 30px rgba(255,46,159,0.15), 0 8px 24px rgba(0,0,0,0.6)",
  backdropFilter: "blur(8px)",
  animation: "chatScreenIn 400ms cubic-bezier(0.2,1.5,0.4,1) forwards",
}

// Author label
{
  fontFamily: '"Inter", system-ui, sans-serif',
  fontWeight: 800,
  fontSize: 13,
  letterSpacing: 1,
  color: "#22e2ff", // cyan
  textTransform: "uppercase",
  marginBottom: 4,
}

// Message text
{
  fontFamily: '"Inter", system-ui, sans-serif',
  fontWeight: 600,
  fontSize: 26,
  color: "#f0f0f8",
  lineHeight: 1.3,
  wordBreak: "break-word",
  textTransform: "uppercase",
}
```

### 5.5 CSS Keyframes

```css
@keyframes chatScreenIn {
  0% { opacity: 0; transform: translateX(-50%) translateY(20px) scale(0.95); }
  100% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
}
```

---

## 6. Security / Safety Considerations

### 6.1 XSS Prevention
- Message text is already stripped of HTML by `parseChatBody` in vdoninjaChat.ts
- React renders as text nodes (no dangerouslySetInnerHTML)
- The `author` field is also plain text from VDO.Ninja's label system
- No new attack surface

### 6.2 Message Length
- Enforce max 200 chars on the overlay (truncate with ellipsis)
- Enforce max 200 chars in `validatePayload` (reject longer)

### 6.3 Rate Limiting
- The producer is the only one who can feature messages (not guests)
- No rate limiting needed beyond the single-message-at-a-time constraint
- If a second message is featured while one is on screen, it replaces the first

### 6.4 Content Moderation
- Producer manually selects messages to feature — implicit moderation
- No automated filtering needed for MVP
- Future: could add a "block sender" list, but not in scope

---

## 7. Files to Modify

| File | Changes |
|------|---------|
| `src/lib/vdoninja.ts` | Add `ChatToScreenEvent` + `ChatToScreenClearEvent` interfaces, add to `EventPayload` union, add to `VALID_TYPES`, add validation in `validatePayload` |
| `src/routes/ProducerRoute.tsx` | Add `useVdoNinjaChat()`, chat message state, "Chat to screen" Section with message list + feature/clear buttons, activity feed entries |
| `src/routes/OverlayRoute.tsx` | Add `chatScreenSprite` state, onMessage cases, `ChatScreenCard` component, sweep interval cleanup, render in canvas |
| `src/index.css` | Add `chatScreenIn` keyframe |

**No new files needed.** Everything fits into the existing architecture.

---

## 8. Implementation Order

1. **Event types** (`vdoninja.ts`): Add interfaces, union member, validation. Type-check passes.
2. **Overlay rendering** (`OverlayRoute.tsx`): Add state, onMessage handler, ChatScreenCard component, keyframe in CSS. Test by sending a raw event via dev console.
3. **Producer panel** (`ProducerRoute.tsx`): Add `useVdoNinjaChat`, chat message buffer, "Chat to screen" section UI, feature/clear handlers.
4. **Build + verify**: `npm run build` passes, test end-to-end.

---

## 9. Edge Cases

| Edge Case | Handling |
|-----------|----------|
| Producer features a message, then another quickly | Second replaces first, timer reset |
| Message has emoji in it | Render as text (emoji are valid Unicode, will display) |
| Very long message | Truncate to 200 chars on overlay |
| Empty message | Rejected in `validatePayload` |
| Overlay refreshes mid-feature | Message is gone (not persisted). Acceptable — same as card announcements. |
| Producer refreshes mid-feature | Chat buffer is lost (not persisted). Acceptable — same as buzz board. |
| Guest sends a message, then disconnects | Message stays in buffer until capped out. If featured, stays until timer or clear. |
| Multiple producers | Both see the same chat. If both feature different messages, last one wins. Acceptable for MVP. |
| Message contains URLs | Rendered as plain text (not clickable). No linkification in MVP. |

---

## 10. Out of Scope (Future Enhancements)

- **Queue mode**: Stack multiple featured messages in a carousel
- **Message reactions**: Overlay audience sees emoji reactions on featured messages
- **Auto-feature**: AI-powered message selection (not happening)
- **Persistent history**: Featured messages saved to a log file
- **Per-guest chat-to-screen**: Guests can feature their own messages (no — producer only)
- **Styling presets**: Different visual treatments (quote, callout, lower-thirdbanner)
- **Twitter/X integration**: Feature tweets alongside chat messages
- **Moderation tools**: Block list, message filtering

---

## 11. Design Questions for Aria

1. Should the featured message card have a Gamified logo or watermark?
2. Should the entrance animation include a sound effect?
3. Position: center-bottom, or lower-third style (bottom-left)?
4. Should we show the sender's VDO.Ninja avatar (if available)?
5. Font: Inter for readability, or Orbitron for brand consistency?
6. Should the card have a "LIVE CHAT" or "AUDIENCE" label badge?

---

## 12. Testing Checklist

- [ ] Producer sees chat messages arriving in real-time
- [ ] Feature button sends event to overlay
- [ ] Overlay renders message with correct styling
- [ ] Auto-dismiss after 20s works
- [ ] Manual clear works
- [ ] Rapid successive features replace correctly
- [ ] Long messages truncate properly
- [ ] HTML in messages is stripped (already by parseChatBody)
- [ ] Build passes clean
- [ ] No console errors in overlay or producer
