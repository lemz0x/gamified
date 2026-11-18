# OBS Scene Setup: Best Practices

How the Gamified browser sources, Sam Cam, and guest cams stack in the
producer's OBS scenes. This doc describes the stack rules, not the raw scene
JSON; the scene collection is intentionally not committed to the repo. The
geometry constants live in `src/coords.ts`, which is the software's source of
truth; use `?calibrate=1` to match the overlay to your scene.

## Source stack order (bottom → top)

1. **Guest cam browser sources**: the 6 (or 4) VDO.Ninja guest cams.
2. **`/underlay` browser source**: beneath the guest cams. Paints emoji
   floats, card animations, SILENCED washes on guest tiles, mute indicators,
   and the calibration grid.
3. **Sam Cam**: VDO.Ninja browser source (`?view=Host1`), chroma-keyed, on
   top of the underlay. The underlay also paints a below-camera copy of
   Sam's SILENCED wash, which is hidden behind his cam; that is expected.
4. **`/overlay` browser source**: top of the stack.

**HARD requirement (since `fa3d560`):** Sam's visible SILENCED wash for
STFU-on-Sam paints on `/overlay`, which MUST sit above the Sam Cam source.
If the overlay is below his cam, the wash will not be visible (the Sept 30
test showed the underlay wash painting "behind" his cam; that is why the
treatment moved to the overlay). Keep `/overlay` at the top of every show
scene.

## Browser source settings (both underlay and overlay)

- **Width / Height:** `1920` x `1080`
- **Custom CSS:** leave empty (body background is transparent via
  `body.overlay-route`)
- **Shutdown source when not visible:** OFF (the data-channel iframe must
  stay mounted, or the surface silently stops receiving events until
  refreshed)

The underlay lives in a dedicated `_Overlay` scene added as a nested scene
source on top of every other scene: one peer connection, one render context,
no scene-switch reconnects.

## Two scene collections: 4-guest and 6-guest

The producer maintains two OBS scene collections ("Gamified" for 6 guests,
"Gamified (4 guests)" for 4).

- **4-guest scenes carry `?layout=4` baked into ALL wrapper URLs**: guests,
  host, and the two browser sources for that collection (`/underlay?layout=4`
  and `/overlay?layout=4`). Since v1.8 the overlay uses the layout to place
  the played card (r5), so on a 4-guest collection it MUST carry `layout=4`.
- **6-guest scenes run plain URLs** (no `layout` param).
- **NEVER run 4 guests on the 6-guest geometry** (or vice versa). Effects
  paint at the active layout's tile coordinates: 4 guests on the 6-guest
  scene paints a phantom tile wash on the empty L3/R3 space, and the seat
  numbering no longer matches what is on screen. This caused a visible
  failure in a September show.
- The **host link rule**: Sam's `/play` URL must carry `?layout=4` on
  4-guest shows. His wrapper is the sole STFU-on-Sam vote evaluator and
  derives the threshold from its own URL. See
  [`stfu-on-sam.md`](./stfu-on-sam.md) and [`url-params.md`](./url-params.md).

## Round 5 set: a third collection beside the classic ones (v1.8)

The Nov 2026 set refresh runs from its own scene collection, built from the classic master, so both can sit on one machine and you switch with **Scene Collection**. The classic collection is the fallback.

- **Both browser sources in the r5 collection carry `set=r5`**: `/underlay?set=r5` and `/overlay?set=r5` (plus `layout=4` on both in a 4-guest r5 collection). If only one has it, card plays go silent on stream: the r5 underlay drops the centre announcement, and a classic overlay ignores card plays.
- **Pre-show check:** open the Underlay with `&debug=1` once; the chip shows `set: r5 · layout: 6` (or 4). Remove `debug=1` before the show.
- The producer panel needs `?set=r5` only to calibrate the r5 tiles; calibration events are tagged with their set, so a classic producer cannot move r5 tiles.
- Calibration is per machine, per set and layout; the Overlay reads the same saved calibration as the Underlay (same OBS browser profile).
- The r5 name plates cover the bottom 14 px of each camera; r5 effects stop at the plate.

## Sam Cam

- VDO.Ninja browser source, `?view=Host1`, chroma-keyed.
- Published at 1920x1080, scaled 0.4688 into the **HOST_TILE box:
  (521, 498, 902 x 507)** at bottom-center of the 1920x1080 canvas
  (`coords.ts` `HOST_TILE`, with per-machine calibration override support).
- Sam's tile position is **constant across layouts** (the same HOST_TILE
  serves both the 4-guest and 6-guest scenes).

## Deploy origin changes

Every deploy origin change (e.g. migrating the Cloudflare Pages domain)
requires **manually repointing every OBS browser source URL**: the underlay,
the overlay, and any wrapped cam sources that point at the site. OBS caches
URLs in the scene collection; nothing updates them automatically. Miss one
and that surface keeps rendering the old deploy (or dies when the old origin
goes away).

## Scene JSON is not in the repo (on purpose)

The scene collection exports stay on the producer's OBS machines. Geometry
is transcribed into `src/coords.ts` (`TILES`, `TILES_4`, `HOST_TILE`), which
is authoritative for where effects paint. Tile sizes are
**design-dependent**: roughly 290px tiles on the 6-guest scene and 350px on
the 4-guest scene as of Oct 2026, and vary with the overlay design. Do not
copy numbers between docs; calibrate to your actual scene with `?calibrate=1`
(underlay only) and trust the calibration values it persists.

## Further reading

- [`obs-cef-gotchas.md`](./obs-cef-gotchas.md): OBS/CEF rendering quirks,
  Source Record encoder defaults, focus rings
- [`vdo-ninja-quality-params.md`](./vdo-ninja-quality-params.md): guest
  quality URL params and OBS encoder settings
- [`obs-source-record-setup.md`](./obs-source-record-setup.md): guest ISO
  recording via the Source Record plugin
- [`url-params.md`](./url-params.md): every wrapper URL parameter