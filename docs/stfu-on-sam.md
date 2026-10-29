# STFU on Sam — Guest Vote Mechanic

**Status:** Shipped (in production; merged Oct 21 2026 via PR #69)
**Origin:** Backlog idea from Aug 5 2026 session; scope confirmed by Lemz Sep 30 2026.
**Reference:** [`AGENTS.md`](../AGENTS.md) covers the current architecture; this doc is the mechanic's own spec.

## Post-prototype backlog (Oct 14 2026, Lemz)

| # | Item | Notes |
|---|------|-------|
| 1 | Self-mute visibility | **SHIPPED Oct 15** — `micState` broadcast on every guest self-toggle (suppressed during force mutes). Producer + host panels show LIVE green / SELF-MUTED amber / MUTED red; host-mute wins display. State is transient like buzz (panel reload loses it until next toggle). |
| 2 | Pill size | Accepted after episode-size tweak; Lemz may want a final trim after seeing it live. |
| 3 | 4-guest layout support | **DONE Oct 14** — `samVoteThreshold(layout)` (2-of-4 / 3-of-6), shared by wrappers + producer via `vdoninja.ts`. Root cause of the Oct 14 failure was the host link missing `?layout=4` — see "Show link format" below. |

## Concept

Guests can collectively vote to STFU the host (Sam). It's about a moment in
time — enough guests think Sam needs to shut up *right now*, they gang up, and
his mic is hard-locked for 10s. The host must never see it coming.

## Locked decisions (Lemz, Sep 30 2026)

| # | Decision | Call |
|---|----------|------|
| 1 | Vote window | **60s timer** (was 30s — extended Oct 14 after live feedback). No withdrawal; votes auto-expire at 0. First vote starts the window. Visual cue (flash/glow) on other guests' UI so they see the rebellion forming. |
| 2 | Mute type on Sam | **Hard lock** — same rules as guest STFU: mic forced false + circuit breaker re-asserts; Sam cannot self-unmute for the duration. Duration: 10s (same as guest STFU). |
| 3 | Card consumption | Guests reserve their STFU card when voting; **consumed only on success**. Timeout = card refunded. |
| 4 | Vote threshold | **2 in 4-guest layout, 3 in 6-guest layout** (half the panel). **Lemz (producer) may also vote** — he's a known figure just behind the scenes; his vote counts toward the threshold. |
| 5 | Cooldown | **Flat 10s after success AND timeout** (was 60/30 — collapsed Oct 14 for cross-tab sync; matches Sam's mute length so windows can't overlap). Host's `cooldownEndsAt` syncs every tab's countdown. |
| 6 | Target on success | Voters stay unmuted. **Everyone else including Sam gets the STFU area-mute** (non-voter guests + host hard-muted 10s). |
| 7 | Visibility | Guest UI + producer panel only. **NEVER on Sam's host screen** — the host wrapper must tally votes silently with zero UI. |

## Wire protocol (new P2P events)

```ts
// A voter (guest seat or "lemz") casts a vote for the current window.
interface SamVoteEvent {
  type: "samVote";
  from: EventSender;      // guest: {kind:"guest", seat, label} | lemz: {kind:"lemz"}
  windowId: number;       // Date.now() of the first vote — groups votes into a window
  ts: number;
}

// Broadcast when the threshold is met. The HOST wrapper emits this (the
// sole committer — audit #3); guests tally for display only and act on
// this event. Everyone hard-mutes non-voters + host.
interface SamStfuEvent {
  type: "samStfu";
  windowId: number;
  voters: string[];       // seat ids + "lemz" — non-voters get area-muted
  ts: number;
}
```

- New `EventSender` variant: `{ kind: "lemz" }` (producer-side vote).
- Host wrapper counts `samVote` against the layout's threshold. On reach, it
  force-mutes its own iframe and starts the circuit breaker — **no UI, no
  audio cue on host wrapper** (guests' wrappers play the STFU SFX).
- `samStfu` is broadcast so the overlay can paint SILENCED on Sam's tile (above
  his cam in OBS z-order; the underlay keeps a below-camera copy), the underlay
  can paint SILENCED on non-voter guest tiles, and guest wrappers can burn
  voters' cards.
- Timeout is local: each wrapper runs the 60s window from the first vote
  (`windowId` provides the shared clock anchor). At 0, votes expire. No
  broadcast needed — everyone times out together. Clock skew handled by
  clamping: votes arriving after local 0 are ignored.
- Vote state is transient (like buzz state) — late joiners don't get backfilled.
  If no threshold is met, nothing happened as far as the show record goes.

## Who does what

| Surface | Behaviour |
|---------|-----------|
| Guest wrapper (`/play`) | "STFU SAM" button under cards. While a window is open: progress bar (n/threshold), seconds remaining, own-vote state. First vote from someone else → flash/glow cue. On success: non-voters area-muted 10s, voters burn STFU card. |
| Host wrapper (`/play?role=host`) | Silently counts votes. **Sole threshold evaluator + committer** (audit #3): on threshold it hard-mutes its own iframe + circuit breaker 10s and emits the one `samStfu`. **Zero UI feedback** — no toast, no badge, no SFX on host side. |
| Producer panel (`/producer`) | Lemz's vote button (identical rules: reserves nothing since producer has no cards, but counts toward threshold). Live tally display. |
| Underlay (`/underlay`) | On `samStfu`: SILENCED wash on non-voter guest tiles (per-seat expiry). Also paints a below-camera copy of Sam's wash, but since `fa3d560` the *visible* SILENCED treatment on Sam paints on `/overlay`, which sits above Sam Cam in OBS z-order. Underlay copy alone is hidden behind his camera. |
| Overlay (`/overlay`) | On `samStfu`: paints Sam's SILENCED wash (elliptical variant, `e3001e1`) over his cam for the 10s hard-lock window. Requires the `/overlay` browser source to sit ABOVE Sam Cam in the OBS source stack. |
| Sam's screen | Nothing. Ever. |

## Show link format (producer keeps these in the Google doc — no generator UI)

The producer panel does NOT generate links anymore. Hand-build them like this
(push IDs are the stable VDO.Ninja stream IDs the OBS cam sources watch):

- **Guest (6-cam, default):** `https://<origin>/play?seat=<N>&push=<STREAM_ID>&label=<NAME>`
- **Guest (4-cam):** add `&layout=4`
- **Host (Sam, 6-cam):** `https://<origin>/play?role=host&push=<STREAM_ID>&label=Sam`
- **Host (Sam, 4-cam):** `https://<origin>/play?role=host&layout=4&push=<STREAM_ID>&label=Sam`

**The host link MUST carry the same `?layout=` as the guests.** The host wrapper
is the canonical evaluator of STFU-on-Sam — it derives the vote threshold from
its own URL. A host link without it silently runs the 6-guest universe (3-vote
threshold, 6-seat card grid), which is exactly the Oct 14 show bug.

## Sam's tile geometry (from Gamified_master.json, Sep 30 2026)

Sam Cam is a 1920x1080 chroma-keyed VDO.Ninja browser source (`?view=Host1`),
scaled 0.4688 into a **(521, 498, 902 x 507)** box at bottom-center of the
1920x1080 canvas. Added to `coords.ts` as `HOST_TILE` with the same
localStorage calibration override support as guest tiles.

## Future / open

- Aria design pass on the button, bar, flash, and Sam's SILENCED treatment.
- Whether vote state needs late-joiner sync (currently transient, like buzz).
- **Host card play on the 4-guest layout is UNTESTED.** Sam's tile position is
  confirmed constant between layouts (same HOST_TILE), but Sam has not played
  cards on the 4-guest layout in a live show to verify: the target picker
  showing 4 seats, card animations landing on TILES_4 geometry, and the
  STFU-on-Sam host link with `?layout=4`. Needs a live test round before the
  next 4-guest show relies on host card play.