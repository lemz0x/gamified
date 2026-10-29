# URL Parameters: Canonical Reference

Every Gamified URL parameter, which routes read it, and what happens when
it is absent or invalid. The code paths behind this table:
`src/routes/PlayRoute.tsx` (seat/role/layout/push/label),
`src/routes/UnderlayRoute.tsx` (calibrate/debug/layout),
`src/routes/ProducerRoute.tsx` and `src/routes/ChatRoute.tsx` (layout,
label), `src/coords.ts` (`resolveLayout`, `LAYOUT_SEATS`, `parseSeat`).

## Parameters

| Param | Values | Read by | Purpose | Absent / invalid behavior |
|-------|--------|---------|---------|---------------------------|
| `seat` | `1`..`6` (6-guest layout) or `1`..`4` (`layout=4`) | `/play` | Which guest seat this wrapper occupies. Maps to tiles `L1, L2, L3, R1, R2, R3` in order (on `layout=4`: `L1, L2, R1, R2`). | Out-of-range or missing → the "Missing URL params" help screen |
| `push` | VDO.Ninja stream ID | `/play`, `/chat` | The guest's existing VDO.Ninja stream ID; the wrapper iframes their publish URL and creates no new peer connection | Missing → the wrapper mounts but the inner iframe has no stream to publish; the help screen is NOT shown for this (it keys off identity, i.e. role/seat) |
| `label` | display name | `/play`, `/chat`, `/editorchat` | Display name in the wrapper header and VDO.Ninja chat. Producer roster updates override it live (`effectiveLabel`) | `/play` falls back to `Host` / `Editor` / `Guest` by role; `/chat` falls back to `Lemz`, `/editorchat` falls back to `Phil` |
| `role` | `host`, `editor`, or absent (guest) | `/play` | `host`: full host panel, joins as codirector, excluded from card target pickers, is the sole STFU-on-Sam vote evaluator. `editor`: audio-only publish (`videodevice=0`), chat-only panel, excluded from target pickers. Absent: guest | Absent = guest; requires `seat` |
| `layout` | `4`, `6`, or absent | `/play`, `/underlay`, `/producer`, `/chat`, `/editorchat` | Selects the OBS scene geometry: 4-guest 2x2 (`TILES_4`, 350x350 tiles) or the default 6-guest grid (`TILES`). Gates seat count, tile positions, target pickers, buzz board, tracker, and the STFU-on-Sam vote threshold (2-of-4 vs 3-of-6) | Absent or any other value → 6-guest layout. **On a 4-guest show every wrapper URL, host link included, must carry `layout=4`** (see [`stfu-on-sam.md`](./stfu-on-sam.md)) |
| `calibrate` | `1` | `/underlay` only | Shows the calibration grid; tile nudges persist per layout in localStorage and broadcast live from the producer panel | Absent = normal rendering |
| `debug` | `1` | `/underlay` only | Shows the connection status chip (data-channel health, event counts) | Absent = hidden |

## Per-route defaults

| Route | Notes |
|-------|-------|
| `/play` | Guest needs `seat` + `push` (`label` has a fallback); host needs `role=host` + `push` (+ `layout=4` on 4-guest shows); editor needs `role=editor` + `push` |
| `/underlay` | No params required; `layout` should match the show; `calibrate=1` and `debug=1` are underlay-only |
| `/overlay` | No params; connects as a data-only codirector on its own |
| `/producer` | No required params; `layout=4` to match a 4-guest show; password-gated |
| `/chat` | `label` defaults to `Lemz`; `layout` gates the tracker grid |
| `/editorchat` | Same as `/chat` but `label` defaults to `Phil` |

The VDO.Ninja-side parameters (`room`, `hash`, `password`, `q`, `broadcast`,
`aspectratio=square`, etc.) are injected by the wrapper into the iframe src
(`GUEST_BROADCAST_PARAMS` in `src/lib/vdoninja.ts`); do not put them in the
wrapper URL yourself. VDO.Ninja parameter research lives in
[`vdo-ninja-quality-params.md`](./vdo-ninja-quality-params.md).