import React from "react";
import type { Tile } from "../coords";

/**
 * SILENCED treatment painted over a muted tile (guest STFU, mute-all, and the
 * STFU-on-Sam host vote).
 *
 * OBS composites browser sources as separate layers, so CSS mix-blend-mode
 * can't reach the camera feed. Multi-layer approach to simulate desaturation:
 *
 *   1. Blue-teal darkening wash — cools colors toward blue-gray.
 *   2. Radial gray wash — center lighter (face visible), darker edges.
 *   3. Red edge vignette — reads as "punished", not just "muted".
 *   4. SILENCED label — Orbitron 900 in STFU red, lower third centered.
 *      Animates in via @keyframes silencedLabelIn (src/index.css).
 *
 * Shared between UnderlayRoute (guest tiles — underlay sits ABOVE guest cams
 * in the OBS scene) and OverlayRoute (host tile — Sam Cam sits ABOVE the
 * underlay in every show scene, so his treatment must paint on the overlay,
 * which is above him). See docs/stfu-on-sam.md §Visuals.
 *
 * Two variants:
 *   - "tile" (default): guest cam square. Hard-edged rounded box — matches
 *     the tile geometry, red edge vignette reads as "punished".
 *   - "host": Sam is a chroma-keyed subject floating on the scene, NOT a
 *     framed tile. Same dulling layers concentrated at center, but each
 *     gradient fades to fully transparent toward the box edges so the wash
 *     melts into the scene instead of ending at a visible rectangle. No
 *     border-radius clip, no red vignette (a border tint is the opposite
 *     of blending). The keyed-out background simply doesn't render the
 *     wash, so it reads as a color grade landing on him.
 */
export const MutedTileOverlay = React.memo(function MutedTileOverlay({
  tile,
  label = "SILENCED",
  variant = "tile",
}: {
  tile: Tile;
  label?: string;
  variant?: "tile" | "host";
}) {
  const labelSize = Math.max(12, Math.round(tile.w * 0.05));
  const bleed = variant === "tile" ? 8 : 0;
  const radius = Math.round(Math.min(tile.w, tile.h) * 0.22);

  // Host variant: elliptical gradients that hit zero alpha inside the box.
  // Guest center opacities preserved at Sam's center so the *dulling* reads
  // the same; only the edge treatment differs.
  const washBackground =
    variant === "host"
      ? // Blue-teal cooling wash, fading out left/right to blend with scene.
        "radial-gradient(ellipse 55% 60% at 50% 45%, rgba(30,45,65,0.60) 0%, rgba(30,45,65,0.42) 60%, rgba(30,45,65,0) 100%)"
      : "rgba(30,45,65,0.55)";
  const grayBackground =
    variant === "host"
      ? // Radial gray desaturation — center lighter (face visible), fading
        // to transparent instead of the guest version's darker edges.
        "radial-gradient(ellipse 55% 60% at 50% 45%, rgba(60,65,78,0.35) 0%, rgba(40,45,55,0.50) 55%, rgba(40,45,55,0) 100%)"
      : "radial-gradient(ellipse at 50% 45%, rgba(60,65,78,0.35) 0%, rgba(40,45,55,0.65) 55%, rgba(20,22,28,0.88) 100%)";

  return (
    <div
      style={{
        position: "absolute",
        left: tile.x - bleed,
        top: tile.y - bleed,
        width: tile.w + bleed * 2,
        height: tile.h + bleed * 2,
        pointerEvents: "none",
        overflow: "hidden",
        borderRadius: variant === "tile" ? radius + bleed : undefined,
      }}
    >
      {/* Layer 1: Blue-teal cooling wash. Cools skin tones toward blue-gray
          so it reads as "desaturated" rather than "gray box over camera".
          Host variant: elliptical, fades to transparent at the box edges. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: washBackground,
          transition: "opacity 300ms ease-out",
          borderRadius: variant === "tile" ? radius + bleed : undefined,
        }}
      />
      {/* Layer 2: Radial gray wash — center lighter (face visible),
          edges darker. Overlaps with blue layer to desaturate.
          Host variant: fades to transparent instead of darkening edges. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: grayBackground,
          transition: "opacity 300ms ease-out",
          borderRadius: variant === "tile" ? radius + bleed : undefined,
        }}
      />
      {/* Layer 3: Red edge vignette — subtle STFU red tint around edges
          so it reads as "punished" not just "muted". Host variant skips
          this: a border tint is the opposite of blending into the scene. */}
      {variant === "tile" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(ellipse at 50% 45%, transparent 50%, rgba(255,46,107,0.08) 80%, rgba(255,46,107,0.15) 100%)",
            transition: "opacity 300ms ease-out",
            borderRadius: radius + bleed,
          }}
        />
      )}
      {/* SILENCED label — animates in with scale + fade */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          bottom: "14%",
          fontFamily: '"Orbitron", system-ui, sans-serif',
          fontWeight: 900,
          fontSize: labelSize,
          letterSpacing: 2,
          color: "#ff2e6b",
          textShadow: "0 0 10px rgba(0,0,0,0.85), 0 0 20px rgba(255,46,107,0.6)",
          padding: "4px 14px",
          borderRadius: 6,
          background: "rgba(10,6,16,0.92)",
          border: "1px solid rgba(255,46,107,0.45)",
          whiteSpace: "nowrap",
          pointerEvents: "none",
          animation: "silencedLabelIn 300ms cubic-bezier(0.2, 1.5, 0.4, 1) forwards",
        }}
      >
        {label}
      </div>
    </div>
  );
});