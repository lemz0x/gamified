# Forking This Repo: Rotation Checklist and Threat Model

Gamified is a no-backend static site: everything needed to join the live
show's VDO.Ninja room ships in the client bundle. If you fork this repo and
share or deploy it, the fork recipient inherits access to the original
show's room. Rotate everything below BEFORE sharing the fork or pointing it
at a real show.

## Rotation checklist

1. **Producer password**: `PRODUCER_PASSWORD` in `src/lib/auth.ts` is
   compiled into the client bundle (the file's own comments admit it gates
   casual visitors, not determined ones). Generate a new value for the fork.
2. **VDO.Ninja room credentials**: `src/lib/vdoninja.ts` hardcodes the
   room name, hash, and password in `GUEST_ROOM_PARAMS` and
   `OVERLAY_PARAMS` (the overlay/producer join as data-only codirectors
   using the same room). Create a new vdo.ninja room for the fork and
   replace all three values.
3. **Push IDs and producer view ID**: replace `PRODUCER_VIEW_ID` (the
   composited Virtual Camera publish ID the host and guests view) and the
   host/guest/editor push IDs used in the wrapper URLs. Every push ID is a
   capability: anyone holding it can publish as that person.
4. **Scrub example IDs from the docs**: `docs/obs-source-record-setup.md`
   embeds a real guest push ID in an example URL; treat it as a placeholder
   and replace it if you keep the doc.
5. **localStorage namespace** (optional): the app reads and writes keys
   under the `gamified.*` namespace (`gamified.auth.v1`, `gamified.roster.v1`,
   `gamified.tiles.calibrated.v1`, `gamified.tiles.calibrated.4.v1`,
   `gamified.tiles.host.v1`, `gamified.tracker.v1`, `gamified.resetEpoch.v1`,
   `gamified.lastResetSeen.v1`, `gamified.hostName.v1`,
   `gamified.cards.uses.<identity>`). If your fork runs alongside the
   original on the same machine, rename the namespace so the two installs
   do not share calibration and auth state.

## Threat model

- **The P2P data channel is trust-by-room-membership.** `validatePayload` in
  `src/lib/vdoninja.ts` blocks malformed payloads (unknown types, bad seat
  IDs, oversized strings), but it cannot block hostile-but-well-formed
  events from room peers: anyone in the room can emit a valid `muteGuest`,
  `samStfu`, `cardReset`, or `calibration` payload and every surface will
  act on it. Sprite concurrency caps and payload bounds mitigate
  flooding/DoS, not impersonation.
- **All credentials are client-side secrets of convenience.** With no
  backend there is nowhere else to put them. This is an accepted risk for a
  friends' show: the room password deters drive-bys, the producer password
  deters casual visitors, and nothing more is claimed.
- **Guest push IDs are semi-secret capabilities.** Anyone with a guest's
  push ID can publish a stream under that ID. Keep the day's push IDs in the
  producer's private show doc, not in shared chats.

## Related docs

- [`../README.md`](../README.md): show-day setup and URL formats
- [`url-params.md`](./url-params.md): full URL parameter reference
- [`vdo-ninja-integration.md`](./vdo-ninja-integration.md): event types,
  validation, and the iframe API boundary