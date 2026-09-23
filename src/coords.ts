/**
 * Tile coordinates on the 1920×1080 OBS canvas.
 *
 * These map each guest "seat" to the on-screen rectangle their VDO.Ninja
 * Browser Source occupies inside the producer's existing OBS scenes. The
 * overlay route uses them as the spawn box for emoji floats and as the
 * target for STFU / MIC DROP card animations.
 *
 * Defaults below were measured directly from the producer's scene file
 * (see AGENTS.md). Calibration mode in the
 * producer panel can override any of them at runtime; overrides are
 * persisted per-machine in localStorage on the overlay browser source's
 * computer (see {@link loadCalibratedTiles}).
 */

export type SeatId = "L1" | "L2" | "L3" | "R1" | "R2" | "R3";

/** Canonical seat order (matches the 6-guest grid: L1..L3 left, R1..R3 right). */
export const SEAT_ORDER: readonly SeatId[] = ["L1", "L2", "L3", "R1", "R2", "R3"];

/**
 * Seats that exist per layout. The 4-guest OBS scene collection is a 2×2
 * arrangement: 2 cams stacked left (L1 top, L2 bottom), 2 stacked right
 * (R1 top, R2 bottom). Seat numbering (`?seat=1..N`) maps onto these in
 * order, identical to the OBS source names Guest1..Guest4 Cam.
 */
export const LAYOUT_SEATS: Record<GuestLayout, readonly SeatId[]> = {
  "6": SEAT_ORDER,
  "4": ["L1", "L2", "R1", "R2"],
};

export type GuestLayout = "4" | "6";

/** Resolves the `?layout=` URL param. Absent/invalid → default six-guest layout. */
export function resolveLayout(raw: string | null): GuestLayout {
  return raw === "4" ? "4" : "6";
}

export interface Tile {
  /** Left edge in pixels on the 1920-wide canvas. */
  x: number;
  /** Top edge in pixels on the 1080-tall canvas. */
  y: number;
  /** Tile width in pixels. */
  w: number;
  /** Tile height in pixels. */
  h: number;
}

export type TileMap = Record<SeatId, Tile>;

/**
 * Default tile coordinates for the six guest seats (1920×1080 canvas).
 * Authoritative defaults — change here only if the producer's OBS scene
 * geometry actually changes. Per-machine tweaks belong in localStorage
 * via the producer panel's calibration mode.
 */
export const TILES: TileMap = {
  L1: { x: 94, y: 53, w: 280, h: 280 }, // top-left      — Guest 1 (Tony)
  L2: { x: 94, y: 382, w: 280, h: 280 }, // middle-left   — Guest 2 (Gnoc)
  L3: { x: 94, y: 717, w: 280, h: 280 }, // bottom-left   — Guest 3 (Matthew)
  R1: { x: 1544, y: 53, w: 280, h: 280 }, // top-right     — Guest 4 (Chris)
  R2: { x: 1545, y: 385, w: 280, h: 280 }, // middle-right  — Guest 5 (Kohji)
  R3: { x: 1544, y: 719, w: 280, h: 280 }, // bottom-right  — Guest 6 (Wills)
};

/**
 * Default 4-guest tile coordinates (1920×1080 canvas).
 *
 * Measured from the producer's "Gamified (4 guests)" OBS scene collection
 * export (all 8 scenes verified identical): Guest1..Guest4 Cam browser
 * sources, 1080×1080 published square, scale 0.3241, align top-left, no
 * crop → 350×350 on canvas, 2×2 arrangement. Same authoring rules as the
 * 6-guest map above — only re-measure if the 4-guest OBS scene geometry
 * actually changes. Measured 2026-09-16.
 */
export const TILES_4: TileMap = {
  L1: { x: 62, y: 139, w: 350, h: 350 }, // top-left      — Guest1 Cam
  L2: { x: 62, y: 586, w: 350, h: 350 }, // bottom-left   — Guest2 Cam
  R1: { x: 1509, y: 140, w: 350, h: 350 }, // top-right     — Guest3 Cam
  R2: { x: 1508, y: 587, w: 350, h: 350 }, // bottom-right  — Guest4 Cam
  // L3/R3 do not exist in the 4-guest layout (no cam source there). The
  // map stays full-universe for type safety, but LAYOUT_SEATS["4"] never
  // includes them, so nothing paints or targets these entries.
  L3: TILES.L3,
  R3: TILES.R3,
};

/** Tile defaults per layout. */
export const LAYOUT_TILES: Record<GuestLayout, TileMap> = {
  "6": TILES,
  "4": TILES_4,
};

/** localStorage key used by the overlay route + calibration mode. */
export const TILES_STORAGE_KEY = "gamified.tiles.calibrated.v1";

/**
 * localStorage calibration key per layout. Separate key per layout so
 * nudges saved for the 6-guest scene never leak into the 4-guest scene
 * calibration (and vice versa). The 6-guest key is preserved byte-for-byte
 * so existing saved calibrations keep working.
 */
export function tilesStorageKey(layout: GuestLayout): string {
  return layout === "6"
    ? TILES_STORAGE_KEY
    : `gamified.tiles.calibrated.${layout}.v1`;
}

/** Layout-specific default tile map (before calibration overrides). */
export function defaultTilesFor(layout: GuestLayout): TileMap {
  return { ...LAYOUT_TILES[layout] };
}

/**
 * Returns the tile map to render against, applying any per-tile overrides
 * persisted in localStorage on this machine for the given layout. Falls
 * back to the layout's defaults if nothing is stored or the stored value
 * is unreadable. Safe to call during SSR — returns defaults if `window`
 * is not available.
 */
export function loadCalibratedTiles(layout: GuestLayout = "6"): TileMap {
  if (typeof window === "undefined") return defaultTilesFor(layout);
  const merged: TileMap = defaultTilesFor(layout);
  try {
    const raw = window.localStorage.getItem(tilesStorageKey(layout));
    if (!raw) return merged;
    const parsed = JSON.parse(raw) as Partial<TileMap> | null;
    if (!parsed || typeof parsed !== "object") return merged;
    for (const seat of LAYOUT_SEATS[layout]) {
      const override = parsed[seat];
      if (isTile(override)) merged[seat] = override;
    }
    return merged;
  } catch {
    return merged;
  }
}

/**
 * Persists the given tile map as the per-machine calibration override for
 * the given layout. Pass the full map; partial saves are not supported —
 * the overlay always reads the whole set.
 */
export function saveCalibratedTiles(tiles: TileMap, layout: GuestLayout = "6"): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(tilesStorageKey(layout), JSON.stringify(tiles));
  } catch {
    // Quota exceeded or storage disabled — silently ignore; defaults still work.
  }
}

/** Removes any stored calibration overrides on this machine for the given layout. */
export function clearCalibratedTiles(layout: GuestLayout = "6"): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(tilesStorageKey(layout));
  } catch {
    // ignore
  }
}

function isTile(value: unknown): value is Tile {
  if (!value || typeof value !== "object") return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.x === "number" &&
    typeof t.y === "number" &&
    typeof t.w === "number" &&
    typeof t.h === "number"
  );
}
