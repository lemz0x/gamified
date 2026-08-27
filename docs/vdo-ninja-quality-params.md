# VDO.Ninja Quality Parameters — Research Notes

Cross-referenced against official docs (docs.vdo.ninja) and the Gamified
codebase (`src/lib/vdoninja.ts`). Context: reviewing quality optimisation
proposals and deciding which URL parameters to add to guest URLs.

All recommendations below are **shipped in v1.6** (PR #63). This document
preserves the research and rationale for forkers who want to understand or
adjust the parameters.

## `&q` / `&quality` — Already Correct, Don't Touch

`&q` is a documented **alias** for `&quality`. Per the official docs:

- `&quality=0` (or no value) → targets ~1920x1080, depending on hardware
- `&quality=1` → targets ~1280x720
- `&quality=2` → targets ~640x360

The guest URL has `&q` (flag-style, no value). This IS `&quality=0`, which IS
targeting 1080p. Replacing `&q` with `&quality=0` is a cosmetic rename with
zero functional change.

The docs say "depending on hardware" — VDO.Ninja can still downgrade
resolution if the guest's device/CPU can't handle 1080p. But the parameter
itself is not the problem.

**Verification step (worth doing per guest during pre-show):** Open a solo
view URL (`https://vdo.ninja/?view=<pushID>&solo&room=...`) in Chrome without
`&clean` to see the real inbound resolution/bitrate stats. The director
dashboard stats show the green room preview feed (deliberately low quality),
NOT what OBS receives.

## `&aspectratio=square` — Shipped in v1.6

**What it does:** Publisher-side aspect ratio change. Holds height constant
(varies width) unless `&width` is also set. With `&quality=0` fixing height
at 1080, `&aspectratio=square` yields **1080x1080 published directly**.

**Why:** The OBS overlay crops every guest to a square tile (298x298) anyway.
Without square capture, guests encode 2.07M pixels (1920x1080), ~890k of
which are discarded on arrival. Square capture means 1.17M pixels encoded —
all used. 44% pixel reduction. With dual-OBS (each guest uploads twice),
that's real bandwidth savings on both upstreams.

**Effective gain:** 15-25% improvement in bits-per-visible-pixel (not the
full 44% — codecs handle static side strips efficiently, so the discarded
pixels cost few bits per frame).

**Risk — loss of OBS panning:** Currently if a guest sits off-centre, the OBS
crop can be slid to correct. Square capture eliminates those pixels entirely.

**Mitigation:** Guest self-preview becomes square, so they see what's
broadcast. Pre-show framing check handles the rest.

**Browser compatibility:** Docs say "not supported by all browsers" with no
specifics. Needs per-guest verification in staging. Unsupported browsers
likely fall back to 16:9 silently, which means their OBS source needs the crop
filter back. Mixed aspect ratios across guests is the actual risk.

**Rejected alternative:** `&aspectratio=1.33333` (4:3 → 1440x1080) retains
±180px of horizontal reframe room while eliminating ~25% of wasted pixels.
Rejected because the OBS overlay uses square cutouts for guest cams — no
point in 4:3 when the final crop is square anyway.

**OBS changes required (per guest source, both machines):**
1. Browser source Width/Height: 1920x1080 → 1080x1080
2. Remove crop filter (or set all crop values to 0)
3. Reposition source to 298x298 in Edit Transform
4. Scale Filtering → Lanczos (corrected from Area — Lanczos is sharper for downscaling faces)

## `&contenthint=detail` — Shipped in v1.6

**What it does:** Tells the browser to prioritise resolution over framerate
when the connection degrades. Camera sources default to `motion` (prioritise
framerate). For a talking-head show where tiles render at 298px and get
upscaled for shorts, resolution matters more than framerate.

**Compatibility:** "Tested on Chrome, but other browsers may vary. Safari
seems to just ignore things." Unsupported browsers ignore it silently. Zero
downside.

## `&maxframerate=30` — Shipped in v1.6

**What it does:** Like `&fps` but graceful — allows lower frame rates if the
camera doesn't support the requested rate. `&fps=30` is strict and can fail
on cameras that don't support exactly 30fps.

**Why:** If a guest has a 60Hz display and decent camera, their browser might
publish 60fps. That doubles encode load and bandwidth for zero benefit on a
talking-head show recorded at 30fps. `&maxframerate=30` caps it without
being strict.

**Use `&maxframerate=30`, NOT `&fps=30`.** The strict version can cause
camera init failures on some hardware.

## `&videobitrate` — Viewer-Side, Already Correct on OBS URLs

**What it does:** Sets target video bitrate for a solo/scene view link.
Viewer-side parameter that overrides the sender's `&outboundvideobitrate`
default. Default is ~2500 kbps. OBS source URLs use `&videobitrate=4000`.

**`&outboundvideobitrate`** is the sender-side equivalent (sets default for
viewers that don't specify `&videobitrate`). Adding it to guest URLs would be
redundant since the only viewer requesting video is OBS, which already sets
it. Skip.

## `&password` / `&hash` — Skip

Hash (`&hash=1f71`) is the hashed password. Carrying both `&hash` and
`&password=gaming` exposes the plaintext in every guest link. But if one
guest's browser handles hash-only auth differently, you've delayed show start
for a cosmetic security improvement on a password that's literally `gaming`.
Not worth the risk surface.

## Current Guest URL

```
&q&tips&roombitrate=0&broadcast=TBSqrdw&showlist=0&minipreview&iframetarget=*&aspectratio=square&contenthint=detail&maxframerate=30&push=<ID>&label=<NAME>
```

**Code location:** `GUEST_BROADCAST_PARAMS` in `src/lib/vdoninja.ts`.
The wrapper URL (`/play?seat=1&push=i2zCGkA&label=Tony`) doesn't change —
VDO.Ninja params are injected into the iframe src inside the wrapper.

## OBS Encoder Settings (Separate from VDO.Ninja URL params)

These are OBS output settings, applied per machine:

| Setting | Value | Notes |
|---------|-------|-------|
| Video Encoder | NVIDIA NVENC H.264 | Or AMD AMF / Intel QSV if applicable |
| Rate Control | CQP | Constant Quality. CBR introduces pulsing |
| CQ Level | 18 | Lower = better quality, larger files. 18 is sweet spot for talking heads |
| Preset | P5 (Slow, Good Quality) | P7 is overkill, P4 starts showing artifacts |
| B-frames | 2 | 3 adds latency, 1 is too aggressive. 2 is the balance |
| Audio | 128 kbps AAC | 320 is wasted on voice. 128 is transparent for speech |

**Source Record filters:** Set each filter's encoder individually. They
default to x264 regardless of main output settings. See
[docs/obs-cef-gotchas.md](./obs-cef-gotchas.md) for details.