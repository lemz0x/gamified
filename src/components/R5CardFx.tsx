import React, { type CSSProperties, type ReactNode } from "react";
import type { Tile } from "../coords";
import type { CardId } from "../cards";
import { layoutPixelText, type PixelTextOptions } from "../lib/pixelFont";

/**
 * Round 5 card styles (Lemz's v6 picks, 2026-11-18), used only with `?set=r5`.
 * The classic set keeps today's visuals in UnderlayRoute / MutedTileOverlay.
 *
 *   - Camera effects (underlay): perimeter glow clipped to the exact picture,
 *     T13 STFU slam (today's slam + a short glitch + bars running down once),
 *     A11 neon stopwatch, M1 chrome mic falling through, F7 pixel lettering
 *     with a stepped extrusion, sized to stay inside the picture.
 *   - SILENCED (underlay): red wash + X16 pixel tag in STFU red, said once.
 *   - Played card (overlay): C14 pixel card beside the player's camera.
 *
 * Mockups: explorations/round5/cards/v6.html. Keyframes: src/index.css (r5*).
 * All sizes are authored for a 300 px camera and scale with the tile.
 */

const RGB: Record<CardId | "gold", string> = {
  stfu: "255,46,107",
  wrapitup: "255,119,0",
  micdrop: "0,217,107",
  gold: "255,215,0", // design-system gold #FFD700 (Lemz pick G2, 2026-11-18)
};
const DARK: Record<CardId, string> = { stfu: "#b8123f", wrapitup: "#b94f00", micdrop: "#00894a" };
const LIGHT: Record<CardId, string> = { stfu: "#ff6d96", wrapitup: "#ffa04a", micdrop: "#4dffa6" };
const MAIN: Record<CardId, string> = { stfu: "#ff2e6b", wrapitup: "#ff7700", micdrop: "#00d96b" };

/** On-camera lines (the bleep stays !@#$). */
const CAM_TEXT: Record<CardId, string> = { stfu: "SHUT THE\n!@#$ UP!!", wrapitup: "WRAP IT UP!", micdrop: "MIC DROP" };
/** Card face lines. */
const FACE_TEXT: Record<CardId, string> = { stfu: "SHUT\nTHE\n!@#$\nUP", wrapitup: "WRAP\nIT UP!", micdrop: "MIC\nDROP" };

// ── shared pieces ───────────────────────────────────────────────────────

/** Renders pixel text at `px` CSS pixels per font pixel. */
function PixelText({ opts, px, style }: { opts: PixelTextOptions; px: number; style?: CSSProperties }) {
  const l = layoutPixelText(opts);
  return (
    <svg
      width={+(l.w * px).toFixed(1)}
      height={+(l.h * px).toFixed(1)}
      viewBox={`0 0 ${l.w} ${l.h}`}
      shapeRendering="crispEdges"
      style={{ display: "block", overflow: "visible", ...style }}
    >
      {l.layers.map((layer, i) => (
        <path key={i} d={layer.d} style={{ fill: layer.fill }} />
      ))}
    </svg>
  );
}

/** F7: white pixel letters, stepped extrusion in the card colour then dark. */
const f7 = (card: CardId, fill = "#fff", solidExtrude = true): PixelTextOptions => ({
  text: CAM_TEXT[card],
  fill,
  extrude: solidExtrude ? [`rgb(${RGB[card]})`, DARK[card]] : ["transparent", "transparent"],
  track: 3,
  gap: 4,
});

/** Pixel size for camera text: 4 px at 300 px wide, capped so the text fits inside the picture. */
function camTextPx(card: CardId, tile: Tile, pad: number): number {
  const k = tile.w / 300;
  const l = layoutPixelText(f7(card));
  return Math.min(4 * k, (tile.w - 2 * pad * k) / l.w, (tile.h - pad * k) / l.h);
}

/**
 * Halo clipped to the exact picture: strongest at the edge, fading toward the middle. Blur only, no spread:
 * a spread draws a solid band along the edge, which reads as a border line (Lemz: no line, 2026-11-18).
 */
const edgeGlow = (rgb: string, k: number) =>
  `inset 0 0 ${16 * k}px rgba(${rgb},1), inset 0 0 ${36 * k}px rgba(${rgb},.6), inset 0 0 ${72 * k}px rgba(${rgb},.2)`;

/**
 * The round 5 name plate covers the bottom 14 px of every camera picture (6- and
 * 4-guest; obs-pack/names.html: plate top = camera bottom - 14). Effects stop at
 * the plate so the glow's bottom edge shows instead of running under it.
 */
const PLATE_OVERLAP = 14;

/** A box over the visible camera picture (above the name plate), clipped to it. */
function CamBox({ tile, style, children }: { tile: Tile; style?: CSSProperties; children?: ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        left: tile.x,
        top: tile.y,
        width: tile.w,
        height: tile.h - PLATE_OVERLAP,
        overflow: "hidden",
        borderRadius: 4,
        pointerEvents: "none",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

const fillStyle = (s: CSSProperties): CSSProperties => ({ position: "absolute", inset: 0, ...s });

/** Horizontal slot centred at `top`, holding the slam animation. */
function Slot({ top, delayMs, children }: { top: string; delayMs: number; children: ReactNode }) {
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top, height: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          position: "relative",
          ["--r" as string]: "-2deg",
          willChange: "transform, opacity",
          animation: `r5Slam 2500ms cubic-bezier(0.2, 1.5, 0.4, 1) ${delayMs}ms 1 both`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** The F7 lettering with its soft shadow. */
function CamText({ card, px }: { card: CardId; px: number }) {
  return <PixelText opts={f7(card)} px={px} style={{ filter: "drop-shadow(0 6px 8px rgba(0,0,0,.6))" }} />;
}

// ── camera effects (underlay) ───────────────────────────────────────────

/** STFU on the target: shake, dark wash, red glow and flash, T13 slam. */
export const R5StfuFx = React.memo(function R5StfuFx({ tile }: { tile: Tile }) {
  const k = tile.w / 300;
  const px = camTextPx("stfu", tile, 30);
  const copy = (fill: string, anim: string) => (
    <div style={{ position: "absolute", inset: 0, opacity: 0, animation: anim }}>
      <PixelText opts={f7("stfu", fill, false)} px={px} />
    </div>
  );
  return (
    <CamBox tile={tile} style={{ animation: "stfuTileShake 360ms ease-in-out" }}>
      <div style={fillStyle({ background: "rgba(10,4,8,.65)", opacity: 0, animation: "stfuDim 2500ms ease-out forwards" })} />
      <div style={fillStyle({ boxShadow: edgeGlow(RGB.stfu, k), opacity: 0, animation: "stfuGlowRing 2500ms ease-in-out forwards" })} />
      <div
        style={fillStyle({
          background: "radial-gradient(circle at 50% 50%, transparent 30%, rgba(255,46,107,.6) 65%, rgba(255,20,60,.35) 100%)",
          mixBlendMode: "screen",
          opacity: 0,
          animation: "stfuFlash 2500ms ease-out forwards",
        })}
      />
      <Slot top="50%" delayMs={0}>
        <div style={{ position: "relative" }}>
          {/* T13: cyan and pink copies shake for ~0.55 s as it lands, then blip once as it leaves */}
          {copy("#22e2ff", "r5ShakeA 560ms steps(5) 400ms 1 forwards, r5GlA 240ms steps(4) 2040ms 1 forwards")}
          {copy("#ff2e6b", "r5ShakeB 560ms steps(5) 400ms 1 forwards, r5GlB 240ms steps(4) 2040ms 1 forwards")}
          <div style={{ position: "relative", animation: "r5JitS 500ms steps(5) 420ms 1 none, r5GJit 160ms steps(2) 2060ms 1 none" }}>
            <CamText card="stfu" px={px} />
          </div>
        </div>
      </Slot>
      {/* T2's bars, one pass down the picture */}
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: (40 + i * 62) * k,
            height: (3 + (i % 2) * 4) * k,
            background: i % 2 ? "rgba(34,226,255,.3)" : "rgba(255,46,107,.36)",
            opacity: 0,
            animation: `r5Flash 200ms linear ${420 + i * 100}ms 1 both`,
          }}
        />
      ))}
    </CamBox>
  );
});

/** Neon line drawn twice: orange tube with a warm white core. */
function Tube({ w = 6, core = 2, children }: { w?: number; core?: number; children: ReactNode }) {
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <g stroke="#ff7700" strokeWidth={w}>{children}</g>
      <g stroke="#fff1e2" strokeWidth={core}>{children}</g>
    </g>
  );
}

/** A11: the face drains as the hand makes one sweep; at twelve it clicks, flashes, shakes and rings. */
function NeonStopwatch({ k }: { k: number }) {
  return (
    <svg
      width={100 * k}
      height={112 * k}
      viewBox="0 0 100 112"
      style={{ display: "block", overflow: "visible", filter: "drop-shadow(0 0 4px #ff7700) drop-shadow(0 0 12px #ff7700)" }}
    >
      <g style={{ transformOrigin: "50px 64px", animation: "r5WatchShake 70ms ease-in-out 1300ms 12 alternate both" }}>
        <g style={{ transformOrigin: "50px 14px", animation: "r5PressDown 120ms ease-in-out 1260ms 2 alternate both" }}>
          <Tube><path d="M42 8h16M50 8v10" /></Tube>
        </g>
        <circle
          cx="50" cy="64" r="31.5" fill="none" stroke="#ff7700" strokeOpacity={0.6} strokeWidth={5} strokeDasharray="198"
          transform="rotate(-90 50 64)" style={{ animation: "r5RingDrain 1200ms linear 100ms 1 both" }}
        />
        <circle cx="50" cy="64" r="34" fill="rgba(255,241,226,.22)" style={{ opacity: 0, animation: "r5ZeroFlash 260ms linear 1300ms 3 both" }} />
        <Tube><circle cx="50" cy="64" r="38" /><path d="M80 30l7-7M83 20l8 8" /></Tube>
        <g style={{ transformOrigin: "50px 64px", animation: "r5Sweep 1200ms linear 100ms 1 both" }}>
          <path d="M50 64V36" stroke="#fff1e2" strokeWidth={4.5} strokeLinecap="round" />
        </g>
        <circle cx="50" cy="64" r="4.5" fill="#fff1e2" />
      </g>
      <g style={{ animation: "r5Flash 260ms linear 1300ms 4 both" }}>
        <Tube w={4} core={1.4}><path d="M2 50q-6 14 0 28M-8 44q-9 20 0 40M98 50q6 14 0 28M108 44q9 20 0 40" /></Tube>
      </g>
    </svg>
  );
}

/** WRAP IT UP on the target: wiggle, orange flash and glow, A11 stopwatch, F7 text. */
export const R5WrapFx = React.memo(function R5WrapFx({ tile }: { tile: Tile }) {
  const k = tile.w / 300;
  return (
    <CamBox tile={tile} style={{ animation: "wrapTileShake 360ms ease-in-out" }}>
      <div
        style={fillStyle({
          background: "radial-gradient(circle at 50% 45%, rgba(255,119,0,.85), rgba(255,100,0,.45))",
          mixBlendMode: "screen",
          opacity: 0,
          animation: "wrapFlash 2500ms ease-out forwards",
        })}
      />
      <div style={fillStyle({ boxShadow: edgeGlow(RGB.wrapitup, k), opacity: 0, animation: "wrapGlowRing 2500ms ease-in-out forwards" })} />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "40%",
          transform: "translate(-50%,-50%)",
          opacity: 0,
          animation: "wrapEmojiPulse 2500ms cubic-bezier(0.2, 1.5, 0.4, 1) 100ms both",
        }}
      >
        <NeonStopwatch k={k} />
      </div>
      <Slot top="68%" delayMs={200}>
        <CamText card="wrapitup" px={camTextPx("wrapitup", tile, 18)} />
      </Slot>
    </CamBox>
  );
});

/** MIC DROP on the target: green flash and glow, the chrome mic falling all the way through, F7 text. */
export const R5MicFx = React.memo(function R5MicFx({ tile }: { tile: Tile }) {
  const k = tile.w / 300;
  const sz = Math.max(100, Math.round(tile.h * 0.45));
  const start = -sz - 40;
  return (
    <CamBox tile={tile}>
      <div
        style={fillStyle({
          background: "radial-gradient(circle at 50% 45%, rgba(0,217,107,.85), rgba(0,180,90,.45))",
          mixBlendMode: "screen",
          opacity: 0,
          animation: "micFlash 2500ms ease-out forwards",
        })}
      />
      <div style={fillStyle({ boxShadow: edgeGlow(RGB.micdrop, k), opacity: 0, animation: "micGlowRing 2500ms ease-in-out forwards" })} />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 0,
          transform: `translate(-50%, ${start}px)`,
          ["--mic-start-y" as string]: `${start}px`,
          ["--mic-end-y" as string]: `${tile.h + 30}px`,
          filter: "drop-shadow(0 0 12px rgba(0,217,107,.85)) drop-shadow(0 4px 14px rgba(0,0,0,.7))",
          animation: "micEmojiFall 900ms cubic-bezier(0.55, 0, 1, 0.45) 100ms both",
        }}
      >
        <img src="/cards/mic_chrome.png" alt="" style={{ display: "block", height: Math.round(sz * 1.34), transform: "rotate(38deg)" }} />
      </div>
      <Slot top="50%" delayMs={300}>
        <CamText card="micdrop" px={camTextPx("micdrop", tile, 30)} />
      </Slot>
    </CamBox>
  );
});

/** Gold glow on the player's camera, clipped to the picture. */
export const R5SourceAura = React.memo(function R5SourceAura({ tile }: { tile: Tile }) {
  return (
    <CamBox tile={tile}>
      <div style={fillStyle({ boxShadow: edgeGlow(RGB.gold, tile.w / 300), opacity: 0, animation: "sourceAuraGlow 3000ms ease-in-out forwards" })} />
    </CamBox>
  );
});

const STEP_CLIP =
  "polygon(0 6px,3px 6px,3px 3px,6px 3px,6px 0,calc(100% - 6px) 0,calc(100% - 6px) 3px,calc(100% - 3px) 3px,calc(100% - 3px) 6px,100% 6px,100% calc(100% - 6px),calc(100% - 3px) calc(100% - 6px),calc(100% - 3px) calc(100% - 3px),calc(100% - 6px) calc(100% - 3px),calc(100% - 6px) 100%,6px 100%,6px calc(100% - 3px),3px calc(100% - 3px),3px calc(100% - 6px),0 calc(100% - 6px))";

/** The X16 pixel SILENCED tag, sized by k (1 = a 300 px camera). */
function SilencedTag({ k }: { k: number }) {
  return (
    <div
      style={{
        position: "relative",
        whiteSpace: "nowrap",
        filter: "drop-shadow(3px 3px 0 rgba(0,0,0,.5))",
        ["--r" as string]: "-2deg",
        animation: "r5TapeIn 260ms cubic-bezier(.2,1.6,.4,1) 0ms 1 both",
      }}
    >
      <div style={{ padding: `${8 * k}px ${12 * k}px ${7 * k}px`, background: "linear-gradient(180deg, #ff4466, #d0103a)", clipPath: STEP_CLIP }}>
        <PixelText opts={{ text: "SILENCED", fill: "#fff", shadow: "#7e0a24", track: 2 }} px={2.25 * k} />
      </div>
    </div>
  );
}

/**
 * SILENCED on Sam (STFU-on-Sam vote, drawn on /overlay above his camera). Sam is keyed onto the set, not a framed
 * tile, so the wash is elliptical and fades to nothing inside his box (no edge, no ring), like the classic host
 * variant but in the STFU red family. The tag is the same pixel tag as the guests', a little larger, low in his frame.
 */
export const R5SamSilenced = React.memo(function R5SamSilenced({ tile }: { tile: Tile }) {
  return (
    <div style={{ position: "absolute", left: tile.x, top: tile.y, width: tile.w, height: tile.h, pointerEvents: "none" }}>
      <div style={fillStyle({ background: "radial-gradient(ellipse 55% 60% at 50% 45%, rgba(255,46,90,.20) 0%, rgba(255,46,90,.14) 60%, rgba(255,46,90,0) 100%)" })} />
      <div style={fillStyle({ background: "radial-gradient(ellipse 55% 60% at 50% 45%, rgba(8,4,12,.30) 0%, rgba(8,4,12,.22) 55%, rgba(8,4,12,0) 100%)" })} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: "8%", display: "flex", justifyContent: "center" }}>
        <SilencedTag k={1.25} />
      </div>
    </div>
  );
});

/** SILENCED on a guest camera: red wash and ring, X16 pixel tag in STFU red, said once. */
export const R5Silenced = React.memo(function R5Silenced({ tile }: { tile: Tile }) {
  const k = tile.w / 300;
  return (
    <CamBox tile={tile}>
      {/* STFU red family (Lemz pick P2, 2026-11-18): red = disruption, ties SILENCED to the STFU card */}
      <div style={fillStyle({ background: "linear-gradient(180deg, rgba(255,46,90,.10), rgba(255,46,90,.20))" })} />
      <div style={fillStyle({ background: "rgba(8,4,12,.32)" })} />
      <div style={fillStyle({ boxShadow: `inset 0 0 ${18 * k}px rgba(255,46,90,.8), inset 0 0 ${70 * k}px rgba(120,0,24,.6)` })} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 28 * k - PLATE_OVERLAP, display: "flex", justifyContent: "center" }}>
        <SilencedTag k={k} />
      </div>
    </CamBox>
  );
});

// ── played card (overlay) ───────────────────────────────────────────────

export const CARD_W = 100;
export const CARD_H = 140;
const ROT = 4;
const BW = Math.ceil(CARD_W * Math.cos((ROT * Math.PI) / 180) + CARD_H * Math.sin((ROT * Math.PI) / 180)) + 8;
const BH = Math.ceil(CARD_H * Math.cos((ROT * Math.PI) / 180) + CARD_W * Math.sin((ROT * Math.PI) / 180)) + 8;
/** Round 5 room geometry the card must stay clear of (1920x1080 canvas). */
const JUMBO_BOTTOM = 655; // jumbotron bezel ends at y 653
const FREE_LIMIT = { L: 538, R: 1382 }; // topic-area limit, x 540 / 1380
const JUMBO_LIMIT = { L: 496, R: 1424 }; // jumbotron screen, x 498 / 1422

export interface CardPlacement {
  cx: number;
  cy: number;
  scale: number;
  rot: number;
}

/**
 * Where the played card sits: centred in the gap on the inner side of the
 * player's camera, between the room frame (6 px outside the picture) and the
 * next obstacle, never over a camera or the topic media. Below the jumbotron
 * the obstacle is the topic-area limit; level with it, the jumbotron screen.
 * Scale is as large as the gap allows (max 1). If that drops below 0.7 on a
 * top-row camera (four-up), the card goes in the band above the camera instead.
 */
export function placeCard(tile: Tile): CardPlacement {
  const side = tile.x + tile.w / 2 < 960 ? "L" : "R";
  const right = tile.x + tile.w, bottom = tile.y + tile.h, tcx = tile.x + tile.w / 2, tcy = tile.y + tile.h / 2;
  const frameEdge = side === "L" ? right + 6 : tile.x - 6;
  const gapTo = (limit: number) => Math.abs(limit - frameEdge);
  let cx: number, cy: number, s: number;
  if (tcy - BH / 2 >= JUMBO_BOTTOM) {
    cy = tcy; s = Math.min(1, gapTo(FREE_LIMIT[side]) / BW); cx = (frameEdge + FREE_LIMIT[side]) / 2;
  } else if (bottom - JUMBO_BOTTOM >= BH + 8) {
    cy = (JUMBO_BOTTOM + bottom) / 2; s = Math.min(1, gapTo(FREE_LIMIT[side]) / BW); cx = (frameEdge + FREE_LIMIT[side]) / 2;
  } else {
    cy = tcy; s = Math.min(1, gapTo(JUMBO_LIMIT[side]) / BW); cx = (frameEdge + JUMBO_LIMIT[side]) / 2;
    const band = tile.y - 6;
    // Only a top-row camera has free space above it; any lower camera has another camera there.
    if (s < 0.7 && band >= 100 && band <= 200) { s = Math.min(1, (band - 8) / BH); cx = tcx; cy = band / 2 + 2; }
  }
  return { cx, cy, scale: s, rot: side === "L" ? ROT : -ROT };
}

/**
 * Sam's played card (host plays): standing on the desk just right of his
 * shoulder, beside the plant (Lemz's pick "S5", 2026-11-18). Anchored to Sam's
 * host tile (HOST_TILE 521,498 902x507 puts it at 1245,875), so it follows his
 * calibration. Below the topic area (y > 655) and clear of the bottom-row guest
 * cards in both layouts. The overlay is the top layer, so it sits in front of Sam.
 */
export function placeHostCard(host: Tile): CardPlacement {
  return { cx: host.x + host.w * 0.8027, cy: host.y + host.h * 0.7436, scale: 1, rot: ROT };
}

/** Stepped (pixel-cornered) rectangle outline for the card's inner frame. */
function StepFrame() {
  const W = CARD_W, H = CARD_H, inset = 5, st = 4;
  const x0 = inset, y0 = inset, x1 = W - inset, y1 = H - inset;
  const p = [
    [x0, y0 + 2 * st], [x0 + st, y0 + 2 * st], [x0 + st, y0 + st], [x0 + 2 * st, y0 + st], [x0 + 2 * st, y0],
    [x1 - 2 * st, y0], [x1 - 2 * st, y0 + st], [x1 - st, y0 + st], [x1 - st, y0 + 2 * st], [x1, y0 + 2 * st],
    [x1, y1 - 2 * st], [x1 - st, y1 - 2 * st], [x1 - st, y1 - st], [x1 - 2 * st, y1 - st], [x1 - 2 * st, y1],
    [x0 + 2 * st, y1], [x0 + 2 * st, y1 - st], [x0 + st, y1 - st], [x0 + st, y1 - 2 * st], [x0, y1 - 2 * st],
  ];
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} shapeRendering="crispEdges" style={{ position: "absolute", left: 0, top: 0 }}>
      <polygon points={p.map((q) => q.join(",")).join(" ")} fill="none" stroke="rgba(255,255,255,.85)" strokeWidth={2} strokeLinejoin="miter" />
    </svg>
  );
}

/** C14: plain gradient card, pixel frame, pixel lettering, one slow sheen. Slaps down, holds, then leaves. */
export const R5PlayedCard = React.memo(function R5PlayedCard({ card, at, holdMs }: { card: CardId; at: CardPlacement; holdMs: number }) {
  const face = layoutPixelText({ text: FACE_TEXT[card], shadow: "rgba(0,0,0,.38)" });
  const px = Math.min(3.4, 74 / face.w);
  return (
    <div
      style={{
        position: "absolute",
        left: Math.round(at.cx - CARD_W / 2),
        top: Math.round(at.cy - CARD_H / 2),
        width: CARD_W,
        height: CARD_H,
        transformOrigin: "50% 50%",
        transform: `scale(${at.scale.toFixed(3)})`,
        pointerEvents: "none",
        zIndex: 40,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: CARD_W,
          height: CARD_H,
          boxSizing: "border-box",
          borderRadius: 10,
          padding: "10px 8px",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: `linear-gradient(160deg, ${LIGHT[card]} 0%, ${MAIN[card]} 45%, ${DARK[card]} 100%)`,
          boxShadow: "0 14px 26px rgba(0,0,0,.55)",
          ["--rot" as string]: `${at.rot}deg`,
          animation: `r5CardSlap 460ms cubic-bezier(.2,.9,.3,1) 0ms 1 both, r5CardAway 380ms ease-in ${holdMs}ms 1 forwards`,
        }}
      >
        <StepFrame />
        <div style={{ position: "relative" }}>
          <PixelText opts={{ text: FACE_TEXT[card], shadow: "rgba(0,0,0,.38)" }} px={px} />
        </div>
        <div
          style={{
            position: "absolute",
            top: "-30%",
            left: 30,
            width: 40,
            height: "160%",
            transform: "translateX(-150px) rotate(18deg)",
            background: "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,.55), rgba(255,255,255,0))",
            animation: "r5Sheen 1600ms cubic-bezier(.45,.05,.4,1) 450ms 1 both",
          }}
        />
      </div>
    </div>
  );
});
