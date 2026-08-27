# OBS / Chromium Embedded Framework (CEF) Gotchas

OBS uses Chromium Embedded Framework (CEF) to render browser sources. CEF is
not a full desktop Chrome — it has older rendering engines, missing font
support, and different focus behavior. These are the issues we hit and how we
fixed them.

## Source Record Encoder Defaults to x264, NOT NVENC

**The problem:** Even if your main OBS recording output is set to NVENC, each
Source Record filter defaults to the x264 software encoder. You must manually
change each filter's encoder.

**We ran an entire show with 6 ISO recordings on x264 without realizing it.**
The ISO files were fine, but CPU load was significantly higher than expected,
which caused audio crackling on the ISO tracks (see next item).

**Fix:** For each Source Record filter in each guest browser source:
1. Open the filter properties
2. Change Video Encoder from `x264` to `NVIDIA NVENC H.264` (or your hardware encoder)
3. Verify Audio Encoder is `aac` (default is fine)
4. Apply to all 6+ guest sources on both OBS machines

## Audio Crackling on ISO Files = CPU Encoder Contention

**Symptom:** ISO recordings have crackling audio, but the main OBS recording
of the same guests has clean audio.

**Cause:** CPU encoder contention. When 6 Source Record filters run x264
simultaneously, the CPU can't keep up with encoding 6 video streams + the main
recording. Audio buffers underrun, causing crackle.

**Not caused by:** VDO.Ninja connection issues, network jitter, or guest
microphone problems. If the main recording audio is clean for the same guests
at the same timestamp, it's CPU.

**Diagnostic:**
- If main recording audio is clean AND ISO audio crackles → CPU encoder contention
- If main recording audio also crackles → network/connection issue
- If ISO video also stutters/drops frames → connection issue, not CPU

**Fix:** Switch all Source Record filters to hardware encoder (NVENC/AMF/QSV).

## Emoji Codepoint Compatibility

**The problem:** Newer Unicode emoji don't render in OBS's CEF. They appear as
empty boxes or missing glyphs.

**Example:** U+1F972 (smiling face with tear) renders fine in desktop Chrome
but shows as nothing in OBS browser sources.

**Safe range:** Stick to Unicode 9.0 emoji (U+1F600 through U+1F64F) for the
core facial expressions. These are universally supported in CEF.

**Rule:** Always test emoji in OBS, not just in your desktop browser. Desktop
Chrome has newer font files and Noto Emoji fallbacks that CEF lacks.

**Gamified's emoji set** (`emojis.ts`) is curated for CEF compatibility. If
you add new emoji, verify they render in an OBS browser source before shipping.

## Chromium Focus Ring on Buttons

**The problem:** After clicking a button in an OBS browser source, a bright
outline (focus ring) stays visible around it indefinitely. `outline: none` in
CSS doesn't reliably suppress it in CEF.

**Fix:** Call `e.currentTarget.blur()` in the onClick handler:

```tsx
onClick={(e) => {
  e.currentTarget.blur();
  // ... your click logic
}}
```

This removes focus from the button immediately after click, preventing the
focus ring from persisting. CSS `outline: none` alone is not sufficient in CEF.

**Affected components:** Any clickable button in the overlay or underlay that
might be clicked during a show (card buttons, mute buttons, buzzer clear,
emoji picker).

## Chat Auto-Scroll: Always Pin to Bottom

**The wrong approach:** Smart auto-scroll — only scroll to bottom when the
user is already near the bottom. This is standard for chat apps where users
scroll up to read history.

**Why it's wrong for a live show:** The producer cannot miss messages. If
they scroll up for one second and a new message arrives, smart scroll keeps
them pinned to their scroll position, and they miss the new message. In a
live show context, missing a message can mean missing a cue.

**Fix:** Always pin to bottom on new messages:

```tsx
useEffect(() => {
  if (chatRef.current) {
    chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }
}, [messages]);
```

No conditions. No "is user near bottom" checks. Every new message scrolls to
the bottom. The producer sees every message.

## Browser Source Dimensions vs CSS Dimensions

OBS browser sources have a Width/Height setting that defines the virtual
viewport. CSS dimensions should match the OBS source dimensions exactly:

- Overlay/Underlay: 1920x1080 (standard HD)
- Guest tiles: Positioned within the 1920x1080 canvas via CSS
- Square capture guests: 1080x1080 browser source, 298x298 positioned tile

If CSS dimensions exceed the OBS source dimensions, content gets clipped. If
they're smaller, you get dead space. Match them.

## `&clean` Parameter and OBS Stats

When debugging VDO.Ninja quality in OBS, temporarily remove `&clean` from the
guest URL. `&clean` strips the VDO.Ninja UI including the stats overlay. Without
it, you can right-click the browser source and see real-time resolution,
bitrate, and packet stats.

**Do not ship a show with `&clean` removed.** It exposes VDO.Ninja UI elements
to viewers. Only use this for pre-show debugging.

## Dual-OBS Bandwidth Considerations

Gamified uses two OBS machines (main + ISO). Each guest's video is pulled
twice — once per OBS machine. This means:

- Guest upload bandwidth is doubled (each guest uploads to 2 viewers)
- `&videobitrate=4000` on each OBS view URL means 8Mbps total per guest
- 6 guests × 8Mbps = 48Mbps minimum guest upload capacity needed across all guests
- Square capture (1080x1080 vs 1920x1080) reduces this by ~15-25%

**If guests have bandwidth issues:** Square capture is the single biggest
improvement. `&maxframerate=30` halves framerate-dependent bandwidth. Both
are already in the guest URL params.