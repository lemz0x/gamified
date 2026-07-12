# Architecture History

Deep reference for how and why the Gamified project got to its current state. Read when you need context on past decisions, failed approaches, or why something is the way it is. For current state, see [`AGENTS.md`](./AGENTS.md). For version history, see [`CHANGELOG.md`](./CHANGELOG.md).

## Original build phases (v1.0)

The project was built in 7 phases, each independently shippable:

1. **Cleanup** — deleted legacy Socket.IO server, removed unused routes (LoginRoute, ProducerRoute, HostRoute, OverlayRoute, ContestantRoute)
2. **Config files** — `src/coords.ts`, `src/emojis.ts`, `src/cards.ts`
3. **VDO.Ninja library** — `src/lib/vdoninja.ts` (iframe API, sendData broadcasting, event types)
4. **`/play` wrapper** — iframe + right panel + emoji buttons + card buttons + target picker modal
5. **`/overlay`** (now `/underlay`) — transparent canvas, emoji float animation, STFU + MIC DROP animations
6. **`/producer`** — roster, reset, activity feed, calibration mode
7. **Deploy** — Cloudflare Pages connection, `_redirects`, `_headers`, show-day docs

The project forked from Chris Heatherly's Socket.IO + Fly.io prototype. The genuinely good parts (wrapper concept, card UX, emoji animation language) were re-implemented as a slim layer on top of existing OBS scenes rather than rebuilding the show infrastructure.

## Architecture decisions

### Editor role (?role=editor)
- Editor publishes audio only via `&videodevice=0` (no camera prompt)
- Editor sees producer's virtual cam via `&broadcast` (same as guests)
- Wrapper renders chat-only panel — no cards, no emojis
- Editor is excluded from card target pickers (`kind !== "guest"`)

### Host single-URL pattern
- Host's wrapper URL does everything in one link: publishes camera, joins as codirector, sees broadcast view, renders full panel
- URL pattern: `/play?role=host&push=<pushID>&label=<label>`
- Host's existing OBS Browser Source continues to pull host's cam independently

### Data channel topology
- Producer joins the overlay context as "dataonly codirector" for bidirectional data flow
- This is what fixed the card reset bug after multiple failed attempts
- Do NOT revert to single-direction topologies (e.g. dataonly without codirector)

### Producer auth
- Password lives in `src/lib/auth.ts` as a constant
- `localStorage` key: `gamified.auth.v1`
- ONLY `/producer` is gated — `/play` and `/overlay` are open
- OBS Custom Browser Docks retain `localStorage` across restarts

### Animation primitives
- All animations use CSS transforms, opacity, filter, box-shadow
- NEVER animate layout properties (top, left, width, height) — performance disaster in OBS
- Keyframes in `src/index.css`: `stfuDim`, `sourceAuraGlow`, `cooldownPulse`, `silencedLabelIn`, `wrapGlowRing`, `flow`, `flowPulse`, `cardIn`, `floatUpOverlay`, `stfuTileShake`, `wrapTileShake`, and card-specific keyframes

### Chat infrastructure
- Chat uses VDO.Ninja's native chat (websocket, `sendChat` / `incoming-chat` via iframe postMessage)
- Does NOT use the P2P data channel for chat
- VDO.Ninja's built-in chat UI inside the iframe is preserved as fallback
- DOMParser-based sanitization strips VDO.Ninja's HTML markup (`<b><span class='chat_name'>NAME</span>:</b> MSG`)

## Failed approaches (don't re-attempt)

### Card reset propagation
The reset event needed to flow producer to wrappers via the VDO.Ninja P2P data channel.

**Attempts that did NOT work:**
- v1.1: `localStorage` epoch comparison. Events never reached the wrapper, comparison was moot.
- v1.2 first try: ref-pinned `onMessage` listener. Synthetic verification masked the actual broadcast-side regression.
- PR #25: producer to `&novideo&noaudio&push`. Partial — established peer connection but data wasn't bidirectional.

**What WORKS (current state, PR #26):**
- Producer joins overlay context as `dataonly codirector`. Bidirectional data channel between producer and overlay/wrapper iframes.
- Wrappers receive `CardResetEvent` and clear `localStorage` card counters with React state re-render.
- Verified per-guest tracking: Guest 2's MIC DROP shows "used", Guest 3's shows "1 of 1 left" — different states confirm the channel is delivering correctly.

### Chat HTML parsing
VDO.Ninja sends inbound chat with HTML markup baked in. The wrapper needs to extract NAME as sender, MSG as body, never render raw HTML.

**Attempts that did NOT work:**
- v1.2 first try: `parseChatBody` using DOMParser. Verified with synthetic test cases but failed on real VDO.Ninja messages.
- v1.2-staging logging round: added `console.log` to `vdoninjaChat.ts` to capture VDO.Ninja's actual message shape.

**Status: RESOLVED.** Parser handles all VDO.Ninja message shapes. Raw HTML no longer bleeds into chat panel.

### STFU color iterations
- v1.2 STFU used near-black dim wash that read as "tile being turned off" rather than "tile being punished"
- Initial fix: red tinted overlay. Too subtle.
- PR #30: bright red dim wash `rgba(220,0,40,0.55)`. Better.
- v1.4: switched to `rgba(50,45,60,0.6)` purple-gray for "desaturation" look. Didn't read as grayscale.
- v1.5: tried `mix-blend-mode: saturation`. Doesn't work across OBS browser sources. Resulted in solid box.
- v1.5 final: Aria's layered approach — base wash `rgba(35,35,42,0.72)`, radial vignette, pink accent tint, pulsing pink border ring, SILENCED label.

### MutedTileOverlay sizing
Tile coordinates define square 280x280 bounds. Camera windows have rounded corners + neon ring extending past bounds. Early overlays clipped at square bounds, leaving camera corners uncovered. Fixed by bleeding 8px past tile bounds with matching `borderRadius`.

### reconcileMic stale closure
- `useCallback` version was called inside `onMessage` but wasn't in its dependency array
- Fixed by changing to `reconcileMicRef` — ref-based, zero deps, same pattern as `muteIframeRef`

### Circuit-breaker overengineering
- v1.2 had two separate circuit-breakers (one for host mute, one for STFU), each posting `mic: false` every 500ms
- Consolidated to single interval re-asserting `mic: false` only while `stfuMutedRef` is set. Host mutes are advisory (single-shot, guest can self-unmute). Self-stops when STFU clears.

## What was in the original build spec that is now built

The original build spec listed many items as "out of scope for MVP" or "v2". Most have since been built:

| Original scope | Status |
|----------------|--------|
| Vote highlight borders | Not built |
| Round transition animations | Not built |
| OBS WebSocket auto-trigger | Not built |
| Chat extraction from iframe (Option B) | Built (chat in wrapper panel) |
| Sound effects on cards | Built (v1.4 SFX system) |
| More cards (GOAT, FACTS) | WRAP IT UP added in v1.4 |
| Vote tallies, MVP picker, scoreboards | Not built (requires server) |
| Mobile guest support | Never (desktop only) |

## Original VDO.Ninja URL handling

The wrapper preserves all existing URL params and adds itself as a layer:

- Room-wide constants: `room`, `hash`, `q`, `tips`, `roombitrate=0`
- Per-guest variables: `push` (stream id), `label` (display name)
- Guests do NOT get `view=` — `&broadcast` auto-discovers the director's stream
- Host shares the same URL shape as guests (no explicit `view=`)
- Overlay joins as data-only peer (no video, no audio)
- Producer joins as dataonly codirector for bidirectional data flow

## Reference documents

- [`AGENTS.md`](./AGENTS.md) — current state, rules, source files
- [`CHANGELOG.md`](./CHANGELOG.md) — version history

Internal planning docs (Aria briefs, execution plans, chat-to-screen plans, mockups) live in `_planning/` on local disk only. They are gitignored and not part of the repo.
