# OBS Source Record Setup — Guest ISO Recording

## Hardware Context
- GPU: RTX 2060 Super (8GB GDDR6, 1x NVENC Turing)
- NVENC session limit: Up to 8 concurrent sessions on current drivers
- Target: 6 guest ISO recordings + 1 main recording = 7 NVENC sessions
- Resolution: 1080x1080 @ 30fps (once square publish is live)

## Step 1: Install Source Record Plugin

1. Download from: https://obsproject.com/forum/resources/source-record.1285/
2. Close OBS completely
3. Run the installer (Windows)
4. Reopen OBS

Verify: Right-click any source -> Filters. You should see "Source Record" as an available filter.

## Step 2: Add Source Record Filter to Each Guest Browser Source

You already have 6 guest browser sources in OBS with solo view URLs like:
```
https://vdo.ninja/?view=i2zCGkA&solo&room=GamifiedShow&password=gaming&videobitrate=4000&clean
```

For each guest source:

1. Right-click the browser source -> **Filters**
2. Click **+** under "Audio/Video Filters"
3. Select **Source Record**
4. Click **Close** (defaults are fine for now)

## Step 3: Configure Each Source Record Filter

Double-click each Source Record filter to configure:

| Setting | Value | Why |
|---------|-------|-----|
| **Output Type** | `Recording` | Not streaming, just local files |
| **Recording Path** | `D:/ISO/` (or your preferred drive) | Needs fast SSD. Do NOT use the same drive as your main OBS recording. |
| **Recording Format** | `mkv` | MKV is crash-safe. Remux to MP4 after. |
| **Video Encoder** | `nvidia_nvenc_h264` | Hardware encoding. If "NVENC新 (new)" fails, try the older one. |
| **Rate Control** | `CQP` | Constant quality, variable bitrate |
| **CQ Level** | `18` | Visually lossless. Lower = better quality, bigger files. 16 for max quality. |
| **Keyframe Interval** | `2` | 2 seconds. Standard for editing. |
| **Preset** | `P5: Slow (Good Quality)` | Better compression. Drop to P4 or P3 if GPU struggles. |
| **Tuning** | `High Quality` | Standard for talking heads |
| **Multipass** | `Single Pass` | Faster. Use Two Passes only if GPU has headroom. |
| **Profile** | `high` | Standard |
| **Max B-frames** | `2` | Fewer than main recording to save GPU cycles |

**Audio tab:**
| Setting | Value |
|---------|-------|
| **Track** | `1` |
| **Encoder** | `aac` |
| **Bitrate** | `128` |

## Step 4: Per-Source File Naming

In each Source Record filter, set a unique filename prefix so you don't get collisions:

- Guest 1 source: `Guest1_ISO`
- Guest 2 source: `Guest2_ISO`
- Guest 3 source: `Guest3_ISO`
- Guest 4 source: `Guest4_ISO`
- Guest 5 source: `Guest5_ISO`
- Guest 6 source: `Guest6_ISO`

The filter will append the timestamp automatically.

## Step 5: GPU Load Management

7 concurrent NVENC sessions (6 ISO + 1 main) on a 2060 Super is within the session limit but will push the encoder hard. Mitigations:

1. **Square publish helps a lot here.** 1080x1080 is 45% fewer pixels than 1920x1080. NVENC encodes per-pixel, so this directly reduces GPU load.
2. **30fps cap** (from the `&maxframerate=30` param) halves encode load vs 60fps.
3. **If you get encoder lag** (dropped frames warning in OBS log), drop ISO sources to:
   - CQ Level 20 (still good quality, less work)
   - Preset P4 or P3 (faster encoding, slightly larger files)
   - B-frames 0 (removes ~15% encode cost per stream)
4. **If NVENC sessions are exhausted** (error in OBS log), switch some ISO sources to x264 (CPU encoder):
   - Guest ISOs are 1080x1080@30fps. x264 on `veryfast` preset can handle 2-3 of these on a modern CPU without breaking a sweat.
   - NVENC handles the main recording + remaining ISOs.

## Step 6: Pre-Show Testing Checklist

Run this before the next show:

- [ ] Open OBS with all 6 guest sources + Source Record filters enabled
- [ ] Have guests (or test push IDs) join the room
- [ ] Hit "Start Recording" on OBS (main recording)
- [ ] Source Record filters auto-record when OBS is recording
- [ ] Check each ISO file: correct resolution (1080x1080), audio synced, no corruption
- [ ] Check OBS log for "Encoding lag" or "NVENC error"
- [ ] Check GPU usage in Task Manager — should be under 90% sustained
- [ ] Record for at least 5 minutes to catch thermal throttling

## Step 7: Post-Show Workflow

1. Source Record creates MKV files per guest in your ISO folder
2. If you need MP4: OBS Tools -> Remux Recordings (batch remux)
3. ISO files are uncompressed quality (CQP 18 ~ 15-25 Mbps per guest for talking heads)
4. Hand off to editor with both the main recording and individual ISOs

## Important Notes

- Source Record captures the **raw inbound stream** from VDO.Ninja, not the composited OBS output. This means ISO files are exactly what the guest published: 1080x1080, no OBS crop/scale applied.
- If a guest drops mid-show, their ISO file will stop and a new one starts when they rejoin. You'll see a filename with a new timestamp.
- Source Record does **not** add CPU load for decoding — the browser source already decodes the stream for display. Source Record just encodes the decoded frames to disk.
- Guest ISO quality depends on `&videobitrate=4000` on your OBS view URLs. This is the bitrate the viewer (OBS) requests from VDO.Ninja. 4000kbps for 1080x1080@30fps is plenty for talking heads.
