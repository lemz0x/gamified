import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useSearchParams } from "react-router-dom";
import {
  TILES_STORAGE_KEY,
  loadCalibratedTiles,
  saveCalibratedTiles,
  type SeatId,
  type Tile,
  type TileMap,
} from "../coords";
import {
  buildOverlayDataOnlyUrl,
  useVdoNinja,
  type CardPlayEvent,
  type EmojiEvent,
  type EventPayload,
} from "../lib/vdoninja";

// ── canvas + perf constants ─────────────────────────────────────────────

/** Fixed render target — matches the producer's OBS canvas exactly. */
const CANVAS_W = 1920;
const CANVAS_H = 1080;

/**
 * Soft cap on simultaneous in-flight emoji floats per sender. Spec §3.2:
 * realistic spam tops out at 10–15; 30 is comfortable headroom without
 * letting a runaway sender queue 1k DOM nodes.
 */
const EMOJI_PER_SEAT_CAP = 30;

/** Emoji float animation length (matches `floatUpOverlay` keyframe). */
const EMOJI_FLOAT_MS = 1500;

/** Card animation total length (matches the per-card keyframes in index.css). */
const CARD_ANIM_MS = 2500;

/**
 * Calibration palette — stable per-seat colors so each rect is easy to
 * distinguish on a busy scene during setup.
 */
const CALIBRATION_COLORS: Record<SeatId, string> = {
  L1: "#22e2ff",
  L2: "#a855ff",
  L3: "#ff2e9f",
  R1: "#ffb000",
  R2: "#22ff8a",
  R3: "#ff5454",
};

// ── per-event render state ──────────────────────────────────────────────

interface EmojiSprite {
  id: string;
  seat: SeatId;
  emoji: string;
  /** X offset within the tile (0..tile.w). */
  xWithinTile: number;
  /** Sway direction (+1 / −1) for the slight horizontal drift. */
  swaySign: 1 | -1;
}

interface CardSprite {
  id: string;
  cardId: CardPlayEvent["cardId"];
  targetSeat: SeatId;
}

// ── component ───────────────────────────────────────────────────────────

export function OverlayRoute() {
  const [search] = useSearchParams();
  const calibrateMode = search.get("calibrate") === "1";

  // Per-machine tile overrides (from prior CalibrationEvents). Live in
  // localStorage on this overlay browser source's machine.
  const [tiles, setTiles] = useState<TileMap>(loadCalibratedTiles);

  // Emoji + card animations currently on screen. Trimmed by timers below.
  const [emojiSprites, setEmojiSprites] = useState<readonly EmojiSprite[]>([]);
  const [cardSprites, setCardSprites] = useState<readonly CardSprite[]>([]);
  const idCounter = useRef(0);
  const nextId = () => `${Date.now().toString(36)}-${(idCounter.current++).toString(36)}`;

  // Make the body fully transparent so OBS only composites our sprites.
  // Cross-tab calibration: also pick up direct localStorage writes (e.g.
  // calibration done in a sibling tab) on top of the broadcast events.
  useEffect(() => {
    document.body.classList.add("overlay-route");
    const onStorage = (e: StorageEvent) => {
      if (e.key === TILES_STORAGE_KEY) setTiles(loadCalibratedTiles());
    };
    window.addEventListener("storage", onStorage);
    return () => {
      document.body.classList.remove("overlay-route");
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // Drop emoji sprites once their float animation has finished. Storing
  // them in state lets React reconcile cleanly without a re-render loop.
  const enqueueEmoji = useCallback((sprite: EmojiSprite) => {
    setEmojiSprites((prev) => {
      // Per-seat soft cap: drop the oldest sprite for this seat first.
      const sameSeat = prev.filter((s) => s.seat === sprite.seat);
      let next = prev;
      if (sameSeat.length >= EMOJI_PER_SEAT_CAP) {
        next = prev.filter((s) => s.id !== sameSeat[0]!.id);
      }
      return [...next, sprite];
    });
    window.setTimeout(() => {
      setEmojiSprites((prev) => prev.filter((s) => s.id !== sprite.id));
    }, EMOJI_FLOAT_MS + 80);
  }, []);

  const enqueueCard = useCallback((sprite: CardSprite) => {
    setCardSprites((prev) => [...prev, sprite]);
    window.setTimeout(() => {
      setCardSprites((prev) => prev.filter((s) => s.id !== sprite.id));
    }, CARD_ANIM_MS + 80);
  }, []);

  const onMessage = useCallback(
    (msg: EventPayload) => {
      switch (msg.type) {
        case "emoji":
          handleEmoji(msg, tiles, enqueueEmoji, nextId);
          break;
        case "cardPlay":
          enqueueCard({ id: nextId(), cardId: msg.cardId, targetSeat: msg.targetSeat });
          break;
        case "calibration":
          setTiles(msg.tiles);
          saveCalibratedTiles(msg.tiles);
          break;
        // rosterUpdate, cardReset → handled by /play, not the overlay.
        default:
          break;
      }
    },
    // tiles is intentionally read fresh inside handleEmoji via closure;
    // re-binding the listener every tile change is fine and rare.
    [tiles, enqueueEmoji, enqueueCard],
  );

  const { iframeRef } = useVdoNinja({ onMessage });
  const overlayUrl = useMemo(() => buildOverlayDataOnlyUrl(), []);

  return (
    <div style={styles.root}>
      <div style={styles.canvas}>
        {emojiSprites.map((sprite) => (
          <EmojiFloat key={sprite.id} sprite={sprite} tile={tiles[sprite.seat]} />
        ))}

        {cardSprites.map((sprite) =>
          sprite.cardId === "stfu" ? (
            <StfuCard key={sprite.id} tile={tiles[sprite.targetSeat]} />
          ) : (
            <MicDropCard key={sprite.id} tile={tiles[sprite.targetSeat]} />
          ),
        )}

        {calibrateMode && <CalibrationGrid tiles={tiles} />}
      </div>

      {/*
        Hidden data-channel iframe. We position it off-screen (and 0 size +
        no pointer events) so it never paints over the scene, while
        keeping it mounted so the WebRTC data channel stays connected.
      */}
      <iframe
        ref={iframeRef}
        src={overlayUrl}
        title="VDO.Ninja data channel"
        style={styles.hiddenIframe}
        allow="microphone; camera"
        aria-hidden="true"
        tabIndex={-1}
      />
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────────────────

function handleEmoji(
  msg: EmojiEvent,
  tiles: TileMap,
  enqueue: (sprite: EmojiSprite) => void,
  nextId: () => string,
) {
  // Host has no tile (per build-spec §3.2 emojis come from the *sender's*
  // tile, and §5 only defines six guest tiles). Drop silently.
  if (msg.from.kind !== "guest") return;
  const tile = tiles[msg.from.seat];
  if (!tile) return;
  enqueue({
    id: nextId(),
    seat: msg.from.seat,
    emoji: msg.emoji,
    xWithinTile: Math.random() * tile.w,
    swaySign: Math.random() < 0.5 ? -1 : 1,
  });
}

// ── sprites ─────────────────────────────────────────────────────────────

interface EmojiFloatProps {
  sprite: EmojiSprite;
  tile: Tile;
}

function EmojiFloat({ sprite, tile }: EmojiFloatProps) {
  // Spawn at the bottom edge of the tile, centered on the chosen X.
  // Keep the spawn position in static `top/left` (set once per element);
  // the float itself is a transform-only animation = compositor-friendly.
  const spawnLeft = tile.x + sprite.xWithinTile;
  const spawnTop = tile.y + tile.h - 36; // a touch above the bottom edge
  return (
    <div
      style={{
        position: "absolute",
        left: spawnLeft,
        top: spawnTop,
        width: 0,
        height: 0,
        // The keyframe animates --sway via translate; per-sprite var below.
        ["--sway" as string]: `${sprite.swaySign * 18}px`,
        animation: `floatUpOverlay ${EMOJI_FLOAT_MS}ms cubic-bezier(0.22, 1, 0.36, 1) forwards`,
        willChange: "transform, opacity",
        pointerEvents: "none",
      }}
    >
      <span
        style={{
          position: "absolute",
          transform: "translate(-50%, -50%)",
          fontSize: 56,
          lineHeight: 1,
          filter: "drop-shadow(0 0 12px rgba(0, 0, 0, 0.55))",
          // Keep emoji glyphs from getting AA'd into mush.
          fontFamily:
            '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
        }}
      >
        {sprite.emoji}
      </span>
    </div>
  );
}

/**
 * STFU card animation (target tile only, ~2.5s).
 *
 * v1.2 intensity boost: aggressive flash, deeper dim wash, red inset
 * glow ring, heavier text drop-shadow stack — so it feels like a
 * "moment", not a hiccup.
 *
 * Layers:
 *   1. Tile-shake wrapper (transform-only) — rocks for the first 100ms.
 *   2. Red inset glow ring around the tile edge — pulses 0 → 0.8 → 0
 *      across the full duration.
 *   3. Aggressive red radial flash, fast in, decays.
 *   4. Heavy dim wash holds dark for the bulk of the animation (the
 *      perceived "brightness(0.25) saturate(0.3)" effect — done with a
 *      near-opaque dark overlay because the underlying video lives in a
 *      different OBS source so a CSS filter can't reach it).
 *   5. Two-line "SHUT THE / !@#$ UP!!" slams in with a stacked-stamp
 *      drop-shadow (red + red + red + black + glow).
 */
function StfuCard({ tile }: { tile: Tile }) {
  // 32px at the spec'd 280px width; scales down on smaller tiles.
  const fontSize = Math.max(18, Math.round(tile.w * 0.115));
  return (
    <div
      style={{
        ...tileBoxStyle(tile),
        // Wrapper-level shake animation — a couple of fast oscillations.
        willChange: "transform",
        animation: "stfuTileShake 360ms ease-in-out",
      }}
    >
      {/* Red inset glow ring around tile edge — pulses 0 → 0.8 → 0. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          boxShadow:
            "inset 0 0 30px #ff2e6b, inset 0 0 60px rgba(255, 46, 107, 0.65)",
          opacity: 0,
          willChange: "opacity",
          animation: "stfuGlowRing 2500ms ease-in-out forwards",
        }}
      />
      {/* Aggressive red flash — fast in, decays through the hold. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at 50% 45%, rgba(255, 46, 107, 0.95), rgba(180, 0, 30, 0.7))",
          mixBlendMode: "multiply",
          opacity: 0,
          willChange: "opacity",
          animation: "stfuFlash 2500ms ease-out forwards",
        }}
      />
      {/* Bright red dim wash — clearly reads as "bad / punishment".
          The opacity stays at 0.55 so the underlying video is still
          visible but the tile is unmistakably tinted red. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(220, 0, 40, 0.55)",
          opacity: 0,
          willChange: "opacity",
          animation: "stfuDim 2500ms ease-out forwards",
        }}
      />
      {/* The slam text — heavier drop-shadow stack for v1.2 intensity. */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%) scale(3) rotate(-2deg)",
          opacity: 0,
          willChange: "transform, opacity",
          animation:
            "stfuSlamText 2500ms cubic-bezier(0.2, 1.5, 0.4, 1) forwards",
          fontFamily:
            '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
          fontWeight: 900,
          fontSize,
          lineHeight: 0.95,
          letterSpacing: 1,
          color: "#ffffff",
          textAlign: "center",
          whiteSpace: "pre",
          textShadow: [
            // Tripled red offset — heavier brand stamp
            "3px 3px 0 #ff2e6b",
            "4px 4px 0 #ff2e6b",
            "5px 5px 0 #ff2e6b",
            // Black offset further out for depth
            "7px 7px 0 #000",
            // Stronger outer red glow
            "0 0 24px rgba(255, 46, 107, 1)",
          ].join(", "),
        }}
      >
        {"SHUT THE\n!@#$ UP!!"}
      </div>
    </div>
  );
}

/**
 * MIC DROP card animation (target tile only, ~2.5s).
 *
 * v1.2: green theme (positive crowning), dramatic mic that falls
 * THROUGH the entire tile vertically and exits the bottom edge.
 *
 * Layers:
 *   1. Brief green/amber flash (t=0–200ms) — quick celebratory pop.
 *   2. Green inset glow ring around tile edge — pulses 0 → 0.8 → 0
 *      across the full duration.
 *   3. Falling mic emoji (~100px+, depending on tile.h) — starts above
 *      the tile, falls smoothly through it on a weighty cubic-bezier,
 *      exits the bottom edge entirely. Clipped to tile bounds via the
 *      tile's `overflow: hidden`. Per-tile start/end offsets passed via
 *      CSS custom properties so the keyframe stays generic.
 *   4. "MIC DROP" slams in at the TOP of the tile around t=300ms,
 *      holds during the mic's fall, then fades.
 */
function MicDropCard({ tile }: { tile: Tile }) {
  const fontSize = Math.max(20, Math.round(tile.w * 0.13));
  // Spec: at least 100px font-size, possibly larger. Scale with tile
  // height so smaller calibrated tiles still get a proportionate mic.
  const micSize = Math.max(100, Math.round(tile.h * 0.45));
  // ±120% of tile height — ensures the mic starts FULLY above the tile
  // and exits FULLY below it. Inlined as px so the keyframe can refer to
  // it via var() without depending on a unit context.
  const startY = -Math.round(tile.h * 1.2);
  const endY = Math.round(tile.h * 1.2);
  return (
    <div style={tileBoxStyle(tile)}>
      {/* Brief green flash — t=0–200ms, then fades. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at 50% 45%, rgba(0, 217, 107, 0.85), rgba(0, 180, 90, 0.45))",
          mixBlendMode: "screen",
          opacity: 0,
          willChange: "opacity",
          animation: "micFlash 2500ms ease-out forwards",
        }}
      />
      {/* Green inset glow ring around tile edge — pulses 0 → 0.8 → 0. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          boxShadow:
            "inset 0 0 30px #00d96b, inset 0 0 60px rgba(0, 217, 107, 0.55)",
          opacity: 0,
          willChange: "opacity",
          animation: "micGlowRing 2500ms ease-in-out forwards",
        }}
      />
      {/* Falling mic — starts above tile (translateY(--mic-start-y)),
          falls weighty through the tile, exits bottom (--mic-end-y).
          Tile overflow:hidden makes it appear to enter and exit the
          visible area cleanly. */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 0,
          transform: `translate(-50%, ${startY}px)`,
          ["--mic-start-y" as string]: `${startY}px`,
          ["--mic-end-y" as string]: `${endY}px`,
          willChange: "transform, opacity",
          animation:
            "micEmojiFall 1200ms cubic-bezier(0.4, 0, 0.6, 1) 200ms forwards",
          fontSize: micSize,
          lineHeight: 1,
          fontFamily:
            '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
          filter:
            "drop-shadow(0 0 12px rgba(0, 217, 107, 0.85)) drop-shadow(0 4px 14px rgba(0, 0, 0, 0.7))",
        }}
      >
        {"\u{1F3A4}"}
      </div>
      {/* Slam text — anchored near the TOP of the tile so the falling
          mic passes behind/through the rest of the tile area. */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "18%",
          transform: "translate(-50%, -50%) scale(3) rotate(-2deg)",
          opacity: 0,
          willChange: "transform, opacity",
          animation:
            "micSlamText 2500ms cubic-bezier(0.2, 1.5, 0.4, 1) 300ms forwards",
          fontFamily:
            '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
          fontWeight: 900,
          fontSize,
          letterSpacing: 1.5,
          color: "#ffffff",
          textAlign: "center",
          whiteSpace: "nowrap",
          textShadow: [
            "3px 3px 0 #00d96b",
            "4px 4px 0 #00d96b",
            "5px 5px 0 #00d96b",
            "7px 7px 0 #000",
            "0 0 24px rgba(0, 217, 107, 1)",
          ].join(", "),
        }}
      >
        MIC DROP
      </div>
    </div>
  );
}

function CalibrationGrid({ tiles }: { tiles: TileMap }) {
  return (
    <>
      {(Object.keys(tiles) as SeatId[]).map((seat) => {
        const tile = tiles[seat];
        const color = CALIBRATION_COLORS[seat];
        return (
          <div
            key={seat}
            style={{
              ...tileBoxStyle(tile),
              background: `${color}22`,
              outline: `2px dashed ${color}`,
              outlineOffset: -2,
              color,
              fontSize: 28,
              letterSpacing: 2,
              fontWeight: 800,
              padding: 10,
              boxSizing: "border-box",
              textShadow: "0 0 6px rgba(0, 0, 0, 0.85)",
            }}
          >
            <div>{seat}</div>
            <div style={{ fontSize: 14, opacity: 0.85 }}>
              {`${tile.x},${tile.y} · ${tile.w}×${tile.h}`}
            </div>
          </div>
        );
      })}
    </>
  );
}

function tileBoxStyle(tile: Tile): CSSProperties {
  return {
    position: "absolute",
    left: tile.x,
    top: tile.y,
    width: tile.w,
    height: tile.h,
    overflow: "hidden",
    pointerEvents: "none",
    borderRadius: 20,
  };
}

// ── styles ──────────────────────────────────────────────────────────────

const styles: Record<string, CSSProperties> = {
  root: {
    position: "fixed",
    inset: 0,
    background: "transparent",
    overflow: "hidden",
    pointerEvents: "none",
  },
  canvas: {
    position: "absolute",
    left: 0,
    top: 0,
    width: CANVAS_W,
    height: CANVAS_H,
    pointerEvents: "none",
  },
  hiddenIframe: {
    position: "absolute",
    left: -9999,
    top: -9999,
    width: 1,
    height: 1,
    border: 0,
    opacity: 0,
    pointerEvents: "none",
  },
};
