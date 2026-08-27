# VDO.Ninja Integration — Deep Dive

Everything we learned about VDO.Ninja's iframe API, data channels, and URL
parameter system while building Gamified. This is the knowledge that cost us
multiple debugging sessions, reverse-engineering sessions, and trial-and-error
rounds. If you're forking this repo, this is your shortcut.

## Two Separate API Transports — Do Not Confuse

VDO.Ninja has two completely separate communication channels with different
event names, transports, and use cases:

| API | Function | Transport | Event Example | Used By |
|-----|----------|-----------|---------------|---------|
| Iframe API | `pokeIframeAPI()` | `parent.postMessage(data, session.iframetarget)` | `action: "mic-mute-state"` | Gamified wrapper, any parent-window integration |
| WebSocket / Director API | `pokeAPI()` | `session.apiSocket.send(JSON.stringify(msg))` | `action: "mic"`, `action: "remoteMuted"` | Bitfocus Companion module, director dashboard |

**This caused real debugging pain.** The Bitfocus Companion source code
(`companion-module-vdo-ninja/index.js`) uses `pokeAPI` (WebSocket), NOT
`pokeIframeAPI` (iframe). If you search for "VDO.Ninja mic event" and find
Companion docs describing `action: "mic"`, you'll write event listeners that
never fire, because those events arrive via WebSocket, not postMessage.

**Lesson:** Read VDO.Ninja's source code (`lib.js`, `main.js`), not just
secondary documentation. The source is the only reliable reference for iframe
API behavior.

### Source Code References

All line numbers are approximate and shift between VDO.Ninja versions:

- `lib.js ~line 18454`: `pokeIframeAPI("mic-mute-state", session.muted)` — the actual event post
- `lib.js ~line 10929`: `pokeIframeAPI()` function — uses `session.iframetarget` as postMessage target
- `main.js ~line 6728`: `session.iframetarget` initialization — only set from URL param
- `lib.js ~line 8744`: `{ mic: false }` inbound handler — calls `toggleMute(true)` with `apply=true`
- `lib.js ~line 18333`: `toggleMute()` function — `if (!apply)` block contains the pokeIframeAPI call

## The `iframetarget` URL Parameter

**Without `?iframetarget=*` in the guest URL, no iframe events reach your parent window.**

`pokeIframeAPI` calls `parent.postMessage(data, session.iframetarget)`. The
`session.iframetarget` value is ONLY set when `?iframetarget=` is present in
the VDO.Ninja guest URL (`main.js ~line 6728`). Without it:

- `session.iframetarget` is `undefined`
- `parent.postMessage(data, undefined)` either silently fails or throws depending on browser
- No events reach the parent — your listeners never fire, no errors, nothing

This is why `GUEST_BROADCAST_PARAMS` in `vdoninja.ts` includes
`["iframetarget", "*"]`. If you remove it, mute sync breaks silently.

**Debugging tip:** If iframe-to-parent communication mysteriously stops
working, check for `iframetarget` in the guest URL first. It's the #1 cause
of silent event delivery failure.

## `mic-mute-state` Event Firing Rules

VDO.Ninja's `toggleMute(apply, event)` function has two modes:

### User clicks mic icon (fires event)
`toggleMute()` called with `apply=false` (default). The `if (!apply)` block
runs, which calls `pokeIframeAPI("mic-mute-state", session.muted)`. Event IS
posted to parent.

### Programmatic mute via `{ mic: false }` (does NOT fire event)
The iframe message handler calls `session.muted = true; toggleMute(true)`.
Since `apply=true`, the `if (!apply)` block is SKIPPED. Event is NOT posted.

**This is correct behavior.** It means:
- When a host programmatically mutes a guest, no false-positive `mic-mute-state` event fires
- When a guest clicks their own mic, the event fires and the parent can react (e.g., clear the SILENCED badge)
- You can safely listen for `mic-mute-state` knowing it only means "user clicked their mic"

### Event Format

```js
// Posted by VDO.Ninja to parent when guest clicks their mic:
{ action: "mic-mute-state", value: true }   // mic is now muted
{ action: "mic-mute-state", value: false }  // mic is now unmuted
```

## Label Push via postMessage

VDO.Ninja chat labels can be dynamically updated without a page reload:

```js
iframe.contentWindow.postMessage({ label: newName }, '*');
```

The URL `&label=` parameter only sets the initial label on page load. To
update a guest's display name mid-show (e.g., they typed a nickname in the
green room), post a `label` message directly to the iframe.

In Gamified, `lastPushedLabelRef` prevents wasteful re-posting — the label is
only pushed when it actually changes, not on every render cycle.

## Sender-Side vs Viewer-Side Parameters

VDO.Ninja URL parameters are directional. Using a parameter on the wrong side
has zero effect — no error, just silence.

| Parameter | Side | Requires | What It Does |
|-----------|------|----------|--------------|
| `&aspectratio` | Sender | `&push` | Publisher-side aspect ratio change |
| `&contenthint` | Sender | `&push` | Tell browser to prioritize resolution over framerate |
| `&maxframerate` | Sender | `&push` | Cap publisher framerate (graceful) |
| `&videobitrate` | Viewer | `&view` | Override sender's default bitrate for this viewer |
| `&quality` / `&q` | Viewer | `&view` | Target resolution (0=1080p, 1=720p, 2=360p) |

**Common mistake:** Adding `&videobitrate=4000` to a guest (push) URL. It does
nothing — `videobitrate` is viewer-side. Use `&outboundvideobitrate` on the
sender side if you need to set a default for all viewers (but since OBS
already sets `&videobitrate` on its view URLs, this is redundant).

## `&q` vs `&quality` — Already Correct

`&q` is a documented alias for `&quality`. Per the official docs:

- `&quality=0` (or `&q` with no value) → targets ~1920x1080
- `&quality=1` → targets ~1280x720
- `&quality=2` → targets ~640x360

The guest URL uses `&q` (flag-style, no value), which IS `&quality=0`, which IS
targeting 1080p. "depending on hardware" — VDO.Ninja can still downgrade
resolution if the guest's device/CPU can't handle 1080p.

**Verification tip:** To see real inbound resolution/bitrate for a guest, open
a solo view URL (`https://vdo.ninja/?view=<pushID>&solo&room=...`) in Chrome
WITHOUT `&clean`. The stats overlay shows actual resolution and bitrate. The
director dashboard stats show the green room preview feed (deliberately low
quality), NOT what OBS receives.

## Codirector Topology

Gamified uses a codirector topology for the host's control surface:

- Host joins the VDO.Ninja room as a **codirector** via `&broadcast=<viewID>&push=<hostID>`
- Codirector gets the director's data channel without needing director privileges
- This gives the host's wrapper iframe a peer-to-peer data channel to every guest
- `sendData()` and `onData()` in `vdoninja.ts` use this channel for all event passing (mute, chat, cards, buzzers, emoji)

**Why codirector, not director?** The director role has privileges we don't
need (kick, room config). Codirector gives us the data channel and nothing
else. The actual VDO.Ninja director dashboard is not used during the show.

## Broadcast Auto-Discovery

When a guest joins with `&broadcast=<viewID>`, VDO.Ninja automatically
discovers and connects to the codirector. No manual peer setup needed. The
data channel is established as part of the connection handshake.

This is why the guest URL includes `broadcast=TBSqrdw` — it's the host's view
ID, not the guest's. Guests auto-connect to the host's data channel on join.

## PostMessage Security

The wrapper listens for `message` events from the VDO.Ninja iframe. All
inbound messages are validated:

1. **Origin check:** Verify `event.origin` is the VDO.Ninja domain
2. **Action whitelist:** Only known actions are processed (`mic-mute-state`, `sendData`, etc.)
3. **Payload validation:** Each action has a typed validator (see `vdoninja.ts` event types)

Do not relax these checks. VDO.Ninja iframes can receive messages from any
page that embeds them, and a malicious parent page could otherwise inject
events into Gamified.

## Event Types (vdoninja.ts)

| Event | Direction | Purpose |
|-------|-----------|---------|
| `muteGuest` | host → guest | Soft mute (advisory, guest can self-unmute) |
| `unmuteGuest` | host → guest | Host unmutes a guest |
| `guestSelfUnmuted` | guest → host/producer | Guest clicked VDO.Ninja mic, host should clear indicator |
| `chat` | any → all | Chat message (validated, sanitized) |
| `card` | host → all | Card played (STFU, mic drop, wrap it up) |
| `buzz` | guest → host | Buzzer press |
| `buzzClear` | host → all | Clear all buzzers |
| `emoji` | any → all | Emoji reaction |
| `roster` | host → all | Roster update (seat assignments) |
| `muteCooldownDone` | (deprecated) | Kept for one release cycle to absorb stale events |

## Advisory vs Force Mute

Three separate mute refs with three different behaviors:

| Ref | Type | Can Guest Self-Unmute? | Circuit Breaker? |
|-----|------|------------------------|-------------------|
| `hostMutedRef` | advisory | Yes — clicking VDO.Ninja mic clears it | No |
| `stfuMutedRef` | hard lock | No — `onVdoMicEvent` bails | Yes (150ms) |
| `muteAllRef` | hard lock | No — `onVdoMicEvent` bails | Yes (150ms) |

**Why individual mutes are advisory but mute-all is force:** Individual mutes
are for hot-micing where the guest might need to rejoin once they fix their
audio. Mute-all is for breaking up an argument or silencing the panel — guests
should NOT be able to just click unmute.

## The `reconcileMic` Bidirectional Bug

Original code only had a `mic: false` path. When STFU's 10s timer expired, it
cleared `stfuMutedRef` but `reconcileMic` never sent `{ mic: true }` to
actually unmute the iframe. The mic stayed stuck muted after any timed mute.

Fix: Added the unmute path. When all mute conditions clear, `reconcileMic`
sends `{ mic: true }` — but only if `selfMutedRef` is false, so self-muted
guests don't get force-unmuted by a timer expiring.

**Lesson:** Mute reconciliation must be bidirectional. If you can mute, you
must also be able to unmute. One-directional mute logic creates stuck states.