/**
 * Tile coordinates on the 1920×1080 OBS canvas.
 *
 * These map each guest "seat" to the on-screen rectangle their VDO.Ninja
 * Browser Source occupies inside the producer's existing OBS scenes. The
 * overlay route uses them as the spawn box for emoji floats and as the
 * target for STFU / MIC DROP card animations.
 *
 * Defaults below were measured directly from the producer's scene file
 * (see CLAUDE.md and _planning/build-spec.md §5). Calibration mode in the
 * producer panel can override any of them at runtime; overrides are
 * persisted per-machine in localStorage on the overlay browser source's
 * computer (see {@link loadCalibratedTiles}).
 */

export type SeatId = "L1" | "L2" | "L3" | "R1" | "R2" | "R3";

/** Canonical seat order (matches the 6-guest grid: L1..L3 left, R1..R3 right). */
export const SEAT_ORDER: readonly SeatId[] = ["L1", "L2", "L3", "R1", "R2", "R3"];

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

/** localStorage key used by the overlay route + calibration mode. */
export const TILES_STORAGE_KEY = "gamified.tiles.calibrated.v1";

/**
 * Returns the tile map to render against, applying any per-tile overrides
 * persisted in localStorage on this machine. Falls back to {@link TILES}
 * if nothing is stored or the stored value is unreadable. Safe to call
 * during SSR — returns defaults if `window` is not available.
 */
export function loadCalibratedTiles(): TileMap {
  if (typeof window === "undefined") return { ...TILES };
  try {
    const raw = window.localStorage.getItem(TILES_STORAGE_KEY);
    if (!raw) return { ...TILES };
    const parsed = JSON.parse(raw) as Partial<TileMap> | null;
    if (!parsed || typeof parsed !== "object") return { ...TILES };
    const merged: TileMap = { ...TILES };
    for (const seat of Object.keys(TILES) as SeatId[]) {
      const override = parsed[seat];
      if (isTile(override)) merged[seat] = override;
    }
    return merged;
  } catch {
    return { ...TILES };
  }
}

/**
 * Persists the given tile map as the per-machine calibration override.
 * Pass the full map; partial saves are not supported — the overlay
 * always reads the whole set.
 */
export function saveCalibratedTiles(tiles: TileMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TILES_STORAGE_KEY, JSON.stringify(tiles));
  } catch {
    // Quota exceeded or storage disabled — silently ignore; defaults still work.
  }
}

/** Removes any stored calibration overrides on this machine. */
export function clearCalibratedTiles(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(TILES_STORAGE_KEY);
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
