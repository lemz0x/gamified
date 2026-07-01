import React, {
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
import { CARDS, type CardId } from "../cards";

import { playCardSfx, preloadCardSfx } from "../lib/sfx";

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

/** How long the center-screen card announcement text stays visible. */
const CARD_ANNOUNCE_MS = 6000;

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

import { EMOJI_COLOURS } from "../emojis";

// ── per-event render state ──────────────────────────────────────────────

interface EmojiSprite {
  id: string;
  seat: SeatId;
  emoji: string;
  /** X offset within the tile (0..tile.w). */
  xWithinTile: number;
  /** Sway direction (+1 / −1) for the slight horizontal drift. */
  swaySign: 1 | -1;
  /** Timestamp (ms) after which this sprite should be removed. */
  expiresAt: number;
}

interface CardSprite {
  id: string;
  cardId: CardPlayEvent["cardId"];
  targetSeat: SeatId;
  /** Timestamp (ms) after which this sprite should be removed. */
  expiresAt: number;
}

/** Source aura sprite — gold glow on the tile of whoever played the card. */
interface SourceAuraSprite {
  id: string;
  sourceSeat: SeatId;
  /** Timestamp (ms) after which this sprite should be removed. */
  expiresAt: number;
}

interface CardAnnounce {
  /** Unique id for React key. */
  id: string;
  /** Card id for icon/font rendering. */
  cardId: CardId;
  /** Who played it. */
  fromName: string;
  /** Card display slug (STFU / MIC DROP). */
  cardSlug: string;
  /** Second line: "on Y". */
  text2: string;
  /** Card theme color for the glow. */
  color: string;
}

// ── component ───────────────────────────────────────────────────────────

export function UnderlayRoute() {
  const [search] = useSearchParams();
  const calibrateMode = search.get("calibrate") === "1";
  const debugMode = search.get("debug") === "1";

  // Per-machine tile overrides (from prior CalibrationEvents). Live in
  // localStorage on this overlay browser source's machine.
  const [tiles, setTiles] = useState<TileMap>(loadCalibratedTiles);

  // Roster names synced from producer — used for card announcements.
  const rosterRef = useRef<Record<SeatId, string>>({ L1: "", L2: "", L3: "", R1: "", R2: "", R3: "" });
  const hostNameRef = useRef<string>(
    typeof window !== "undefined"
      ? (window.localStorage.getItem("gamified.hostName.v1") ?? "HOST")
      : "HOST",
  );

  // Emoji + card animations + source auras currently on screen. Trimmed by timers.
  const [emojiSprites, setEmojiSprites] = useState<readonly EmojiSprite[]>([]);
  const [cardSprites, setCardSprites] = useState<readonly CardSprite[]>([]);
  const [sourceAuraSprites, setSourceAuraSprites] = useState<readonly SourceAuraSprite[]>([]);
  const [cardAnnounce, setCardAnnounce] = useState<CardAnnounce | null>(null);

  // Debug HUD: track message counts + last-seen timestamp per type.
  const debugCountsRef = useRef<Record<string, number>>({});
  const debugLastSeenRef = useRef<Record<string, number>>({});
  const [debugSnapshot, setDebugSnapshot] = useState<Record<string, { count: number; lastMs: number }>>({});

  // Muted-seats state: per-seat set of mute reasons. A seat renders
  // SILENCED while any reason remains. "host" is removed by unmuteGuest;
  // "stfu" is removed by the STFU visual timeout (10s). This prevents:
  //  - STFU stacking orphaning a seat (each timeout only removes its own reason)
  //  - STFU expiry visually unmuting a seat the host independently muted
  const [muteReasons, setMuteReasons] = useState<Map<SeatId, Set<"host" | "stfu">>>(new Map());
  // Ref for the STFU area-mute visual timeout so we can clear it on
  // stacking (rapid back-to-back STFU plays) and on component unmount.
  const stfuVisualTimeoutRef = useRef<number | null>(null);

  /** Add a mute reason for one or more seats. */
  const addMuteReasons = useCallback((seats: SeatId[], reason: "host" | "stfu") => {
    setMuteReasons((prev) => {
      const next = new Map(prev);
      for (const s of seats) {
        const reasons = new Set(next.get(s));
        reasons.add(reason);
        next.set(s, reasons);
      }
      return next;
    });
  }, []);

  /** Remove a mute reason for one or more seats. Seat unmutes when all reasons are gone. */
  const removeMuteReasons = useCallback((seats: SeatId[], reason: "host" | "stfu") => {
    setMuteReasons((prev) => {
      const next = new Map(prev);
      for (const s of seats) {
        const reasons = next.get(s);
        if (!reasons) continue;
        const updated = new Set(reasons);
        updated.delete(reason);
        if (updated.size === 0) {
          next.delete(s);
        } else {
          next.set(s, updated);
        }
      }
      return next;
    });
  }, []);

  // Ref to latest muteReasons so the STFU timeout closure reads
  // the current state 10s later (not a stale closure capture).
  const muteReasonsRef = useRef(muteReasons);
  muteReasonsRef.current = muteReasons;

  const idCounter = useRef(0);
  const nextId = () => `${Date.now().toString(36)}-${(idCounter.current++).toString(36)}`;

  // Make the body fully transparent so OBS only composites our sprites.
  // Cross-tab calibration: also pick up direct localStorage writes (e.g.
  // calibration done in a sibling tab) on top of the broadcast events.
  // Preload card SFX so first play is instant (no network delay).
  useEffect(() => { preloadCardSfx(); }, []);

  // Cleanup: clear any pending STFU visual mute timeout on unmount.
  useEffect(() => {
    return () => {
      if (stfuVisualTimeoutRef.current !== null) {
        window.clearTimeout(stfuVisualTimeoutRef.current);
      }
    };
  }, []);

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

  // Single sweep interval: instead of per-sprite setTimeout removals
  // (which create N individual state updates during a spam burst), we
  // stamp each sprite with an expiresAt and run one interval that
  // prunes all expired sprites across all three arrays in one render.
  // Grace margin (80ms) ensures CSS animations finish before removal.
  const SWEEP_INTERVAL_MS = 250;

  useEffect(() => {
    const id = window.setInterval(() => {
      const now = Date.now();
      setEmojiSprites((prev) => prev.filter((s) => s.expiresAt > now));
      setCardSprites((prev) => prev.filter((s) => s.expiresAt > now));
      setSourceAuraSprites((prev) => prev.filter((s) => s.expiresAt > now));
      // Debug HUD: snapshot counters every sweep
      if (debugMode) {
        const snap: Record<string, { count: number; lastMs: number }> = {};
        for (const [k, v] of Object.entries(debugCountsRef.current)) {
          snap[k] = { count: v, lastMs: debugLastSeenRef.current[k] ?? 0 };
        }
        setDebugSnapshot(snap);
      }
    }, SWEEP_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [debugMode]);

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
  }, []);

  const enqueueCard = useCallback((sprite: CardSprite) => {
    setCardSprites((prev) => [...prev, sprite]);
  }, []);

  /** Source aura duration: 300ms fade in + 2.4s hold + 300ms fade out. */
  const SOURCE_AURA_MS = 3000;

  const enqueueSourceAura = useCallback((sprite: SourceAuraSprite) => {
    setSourceAuraSprites((prev) => [...prev, sprite]);
  }, []);

  const onMessage = useCallback(
    (msg: EventPayload) => {
      // Debug HUD: increment counters per event type
      if (debugMode) {
        const t = msg.type as string;
        debugCountsRef.current[t] = (debugCountsRef.current[t] ?? 0) + 1;
        debugLastSeenRef.current[t] = Date.now();
      }
      switch (msg.type) {
        case "emoji":
          handleEmoji(msg, tiles, enqueueEmoji, nextId);
          break;
        case "cardPlay":
          enqueueCard({ id: nextId(), cardId: msg.cardId, targetSeat: msg.targetSeat, expiresAt: Date.now() + CARD_ANIM_MS + 80 });
          // Source aura: show gold glow on the card-player's tile (guests only; host has no tile)
          if (msg.from.kind === "guest") {
            enqueueSourceAura({ id: nextId(), sourceSeat: msg.from.seat, expiresAt: Date.now() + SOURCE_AURA_MS + 80 });
          }
          // STFU area mute visual: when STFU is played, all guest tiles except
          // the source get the "stfu" mute reason for 10s. The actual mic
          // muting happens locally in each guest's PlayRoute, but that
          // doesn't broadcast muteGuest events — so the overlay must handle
          // the visual treatment itself from the cardPlay event.
          // Per-seat mute reasons prevent stacking bugs (each timeout only
          // removes its own "stfu" reason) and host-mute interaction bugs
          // (STFU expiry won't visually clear a host-muted seat).
          if (msg.cardId === "stfu") {
            const sourceSeat = msg.from.kind === "guest" ? msg.from.seat : null;
            const allSeats = Object.keys(tiles) as SeatId[];
            const mutedSeatsArr = sourceSeat
              ? allSeats.filter((s) => s !== sourceSeat)
              : allSeats;
            addMuteReasons(mutedSeatsArr, "stfu");
            // Clear any pending STFU visual timeout (handles stacking:
            // a second STFU extends the window). The old timeout only
            // removed "stfu" reasons, so orphaned "host" reasons are safe.
            if (stfuVisualTimeoutRef.current !== null) {
              window.clearTimeout(stfuVisualTimeoutRef.current);
            }
            // Auto-clear after 10s (matches the STFU mute window in PlayRoute).
            // This removes the "stfu" reason from ALL seats that currently
            // have it — if the host also muted a seat, the "host" reason
            // remains and the seat stays SILENCED.
            stfuVisualTimeoutRef.current = window.setTimeout(() => {
              const stfuSeats = Object.keys(tiles).filter((s) => {
                const reasons = muteReasonsRef.current.get(s as SeatId);
                return reasons?.has("stfu");
              }) as SeatId[];
              removeMuteReasons(stfuSeats, "stfu");
              stfuVisualTimeoutRef.current = null;
            }, 10_000);
          }
          fireCardAnnounce(msg, rosterRef.current, hostNameRef.current, setCardAnnounce);
          playCardSfx(msg.cardId);
          break;
        case "calibration":
          setTiles(msg.tiles);
          saveCalibratedTiles(msg.tiles);
          break;
        case "rosterUpdate":
          rosterRef.current = { ...msg.names };
          if (msg.hostName !== undefined) {
            hostNameRef.current = msg.hostName;
            try { window.localStorage.setItem("gamified.hostName.v1", msg.hostName); } catch {}
          }
          break;
        case "muteGuest": {
          // Add "host" mute reason for target seats
          const targets: SeatId[] = msg.target === "all"
            ? (Object.keys(tiles) as SeatId[])
            : [msg.target as SeatId];
          addMuteReasons(targets, "host");
          break;
        }
        case "unmuteGuest": {
          // Remove "host" mute reason for target seats
          const targets: SeatId[] = msg.target === "all"
            ? (Object.keys(tiles) as SeatId[])
            : [msg.target as SeatId];
          removeMuteReasons(targets, "host");
          break;
        }
        // cardReset, getResetEpoch → not needed by overlay.
        default:
          break;
      }
    },
    // tiles is intentionally read fresh inside handleEmoji via closure;
    // re-binding the listener every tile change is fine and rare.
    [tiles, enqueueEmoji, enqueueCard, enqueueSourceAura, addMuteReasons, removeMuteReasons],
  );

  const { iframeRef } = useVdoNinja({ onMessage });
  const overlayUrl = useMemo(() => buildOverlayDataOnlyUrl(), []);

  return (
    <div style={styles.root}>
      <div style={styles.canvas}>
        {emojiSprites.map((sprite) => (
          <EmojiFloat key={sprite.id} sprite={sprite} tile={tiles[sprite.seat]} />
        ))}

        {cardSprites.map((sprite) => {
          const Comp = CARD_SPRITES[sprite.cardId];
          if (!Comp) return null;
          return <Comp key={sprite.id} tile={tiles[sprite.targetSeat]} />;
        })}

        {sourceAuraSprites.map((sprite) => (
          <SourceAura key={sprite.id} tile={tiles[sprite.sourceSeat]} />
        ))}

        {/* SILENCED overlay — only for STFU, NOT for host mutes.
            Host mutes are audio-only (no visual overlay). */}
        {muteReasons.size > 0 && (Object.keys(tiles) as SeatId[])
          .filter((seat) => muteReasons.get(seat)?.has("stfu"))
          .map((seat) => <MutedTileOverlay key={seat} tile={tiles[seat]} />)}

        {cardAnnounce && <CardAnnounceText key={cardAnnounce.id} announce={cardAnnounce} />}

        {calibrateMode && <CalibrationGrid tiles={tiles} />}
        {debugMode && <DebugHud snapshot={debugSnapshot} sprites={{ emoji: emojiSprites.length, card: cardSprites.length, aura: sourceAuraSprites.length, muted: muteReasons.size }} />}
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

const CARD_COLORS: Record<CardId, string> = {
  stfu: "#ff2e6b",
  micdrop: "#00d96b",
  wrapitup: "#ff7700",
};

/** Card id → overlay sprite component. Declared below component definitions. */

function fireCardAnnounce(
  msg: CardPlayEvent,
  roster: Record<SeatId, string>,
  hostName: string,
  setAnnounce: React.Dispatch<React.SetStateAction<CardAnnounce | null>>,
) {
  const cardDef = CARDS.find((c) => c.id === msg.cardId);
  const cardName = cardDef?.shortName ?? cardDef?.name ?? msg.cardId.toUpperCase();
  const fromName =
    msg.from.kind === "host"
      ? hostName
      : roster[msg.from.seat] || msg.from.label || "?";
  const targetName = roster[msg.targetSeat] || msg.targetLabel || msg.targetSeat;
  const id = `ca-${Date.now()}`;
  setAnnounce({
    id,
    cardId: msg.cardId,
    fromName,
    cardSlug: cardName,
    text2: `on ${targetName}`,
    color: CARD_COLORS[msg.cardId] ?? "#ffffff",
  });
  window.setTimeout(() => {
    setAnnounce((prev: CardAnnounce | null) => (prev?.id === id ? null : prev));
  }, CARD_ANNOUNCE_MS);
}

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
    expiresAt: Date.now() + EMOJI_FLOAT_MS + 80,
  });
}

// ── sprites ─────────────────────────────────────────────────────────────

const CardAnnounceText = React.memo(function CardAnnounceText({ announce }: { announce: CardAnnounce }) {
  return (
    <div
      style={{
        position: "absolute",
        left: CANVAS_W / 2,
        top: CANVAS_H * 0.30,
        transform: "translate(-50%, -50%)",
        zIndex: 100,
        pointerEvents: "none",
        animation: `cardAnnounceIn ${CARD_ANNOUNCE_MS}ms cubic-bezier(0.2, 1.5, 0.4, 1) forwards`,
      }}
    >
      <div
        style={{
          padding: "18px 48px",
          borderRadius: 16,
          background: "rgba(10, 6, 16, 0.90)",
          border: `3px solid ${announce.color}`,
          boxShadow: `0 0 50px ${announce.color}88, 0 0 100px ${announce.color}44`,
          fontFamily: '"Orbitron", sans-serif',
          fontWeight: 900,
          textAlign: "center",
          position: "relative",
          minWidth: 480,
          color: "#ffffff",
          fontSize: "2rem",
          letterSpacing: "0.04em",
          textShadow:
            `0 0 12px rgba(0,0,0,0.5), 0 0 20px ${announce.color}aa, 0 0 45px ${announce.color}66`,
        }}
      >
        {announce.fromName} played {announce.cardSlug} {announce.text2}
      </div>
    </div>
  );
});

interface EmojiFloatProps {
  sprite: EmojiSprite;
  tile: Tile;
}

const EmojiFloat = React.memo(function EmojiFloat({ sprite, tile }: EmojiFloatProps) {
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
          filter: EMOJI_COLOURS[sprite.emoji]
            ? `drop-shadow(0 0 12px ${EMOJI_COLOURS[sprite.emoji].hex}aa) drop-shadow(0 0 24px ${EMOJI_COLOURS[sprite.emoji].hex}66) drop-shadow(0 0 4px rgba(0, 0, 0, 0.7))`
            : "drop-shadow(0 0 12px rgba(0, 0, 0, 0.55))",
          // Keep emoji glyphs from getting AA'd into mush.
          fontFamily:
            '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
        }}
      >
        {sprite.emoji}
      </span>
    </div>
  );
});

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
const StfuCard = React.memo(function StfuCard({ tile }: { tile: Tile }) {
  // 32px at the spec'd 280px width; scales down on smaller tiles.
  const fontSize = Math.max(18, Math.round(tile.w * 0.115));
  return (
    <div
      style={{
        ...cardBoxStyle(tile),
        // Wrapper-level shake animation — a couple of fast oscillations.
        willChange: "transform",
        animation: "stfuTileShake 360ms ease-in-out",
      }}
    >
      {/* Dim wash — darkens the tile so the red layers read on any bg.
          Restored to dark (not Aria's neutral) so the red pop stays punchy. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(10, 4, 8, 0.65)",
          opacity: 0,
          willChange: "opacity",
          animation: "stfuDim 2500ms ease-out forwards",
        }}
      />
      {/* Red inset glow ring — strong halo at edges (restored to original intensity) */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          boxShadow:
            "inset 0 0 50px #ff2e6b, inset 0 0 100px rgba(255, 46, 107, 0.8)",
          opacity: 0,
          willChange: "opacity",
          animation: "stfuGlowRing 2500ms ease-in-out forwards",
        }}
      />
      {/* Red halo flash — screen blend like mic drop, transparent center */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at 50% 50%, transparent 30%, rgba(255, 46, 107, 0.6) 65%, rgba(255, 20, 60, 0.35) 100%)",
          mixBlendMode: "screen",
          opacity: 0,
          willChange: "opacity",
          animation: "stfuFlash 2500ms ease-out forwards",
        }}
      />
      {/* The slam text — Orbitron with atmospheric glow. */}
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
            '"Orbitron", system-ui, sans-serif',
          fontWeight: 900,
          fontSize,
          lineHeight: 0.95,
          letterSpacing: 1,
          color: "#ffffff",
          textAlign: "center",
          whiteSpace: "pre",
          textShadow: [
            "0 0 8px rgba(0,0,0,0.55)",
            "0 0 22px rgba(255,46,107,0.7)",
            "0 0 55px rgba(255,46,107,0.44)",
            "0 0 90px rgba(255,46,107,0.22)",
          ].join(", "),
        }}
      >
        {"SHUT THE\n!@#$ UP!!"}
      </div>
    </div>
  );
});

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
const MicDropCard = React.memo(function MicDropCard({ tile }: { tile: Tile }) {
  const fontSize = Math.max(20, Math.round(tile.w * 0.13));
  const micSize = Math.max(100, Math.round(tile.h * 0.45));
  // Start at the tile's top edge so it doesn't clip into the camera above.
  const startY = 0;
  // End at tile bottom so the mic exits cleanly.
  const endY = tile.h + 10;
  return (
    <div style={cardBoxStyle(tile)}>
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
      {/* Green inset glow ring — pulses 0 → 0.8 → 0 across the full duration. */}
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
          falls weighty through the tile, stops at the bottom edge.
          The mic is clipped to the target tile by the parent cardBoxStyle
          bleed bounds; it won't bleed into the next camera below. */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 0,
          transform: `translate(-50%, ${startY}px)`,
          ["--mic-start-y" as string]: `${startY}px`,
          // End at tile bottom MINUS mic height so the emoji's
          // bottom edge sits flush with the tile bottom — it stays
          // within the target tile and never bleeds into adjacent cameras.
          ["--mic-end-y" as string]: `${endY}px`,
          willChange: "transform, opacity",
          animation:
            "micEmojiFall 700ms cubic-bezier(0.55, 0, 1, 0.45) 100ms forwards",
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
      {/* Slam text — Orbitron with atmospheric green glow */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%) scale(3) rotate(-2deg)",
          opacity: 0,
          willChange: "transform, opacity",
          animation:
            "micSlamText 2500ms cubic-bezier(0.2, 1.5, 0.4, 1) 300ms forwards",
          fontFamily:
            '"Orbitron", system-ui, sans-serif',
          fontWeight: 900,
          fontSize,
          letterSpacing: 1.5,
          color: "#ffffff",
          textAlign: "center",
          whiteSpace: "nowrap",
          textShadow: [
            "0 0 8px rgba(0,0,0,0.55)",
            "0 0 22px rgba(0,217,107,0.7)",
            "0 0 55px rgba(0,217,107,0.44)",
            "0 0 90px rgba(0,217,107,0.22)",
          ].join(", "),
        }}
      >
        MIC DROP
      </div>
    </div>
  );
});

/**
 * WRAP IT UP card animation (target tile only, ~2.5s).
 *
 * Orange theme — a nudge, not an attack. No dim wash. Two visual systems:
 *   1. Tile-targeted: shake, orange flash, glow ring, ⏰ wobble, slam text
 *   2. Center-screen announcement (via CardAnnounceText, fires simultaneously)
 *
 * v1.4: colour changed from yellow (#ffcc00) to orange (#ff7700) to avoid
 * clashing with the gold source aura (#ffd700) — they sat ~15° apart on
 * the hue wheel and read as the same colour family under OBS compositing.
 *
 * Layers:
 *   1. Tile-shake wrapper — subtle wiggle for 360ms.
 *   2. Orange radial flash — screen blend, fast in, decays.
 *   3. Orange inset glow ring — pulses across the full duration.
 *   4. ⏰ emoji wobble — ticking-clock back-and-forth rotation.
 *   5. "WRAP IT UP!" Orbitron slam text with orange atmospheric glow.
 */
const WrapItUpCard = React.memo(function WrapItUpCard({ tile }: { tile: Tile }) {
  const fontSize = Math.max(18, Math.round(tile.w * 0.10));
  return (
    <div
      style={{
        ...cardBoxStyle(tile),
        willChange: "transform",
        animation: "wrapTileShake 360ms ease-in-out",
      }}
    >
      {/* Orange flash — no dim wash, keeping it bright (a nudge, not an attack). */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at 50% 45%, rgba(255, 119, 0, 0.85), rgba(255, 100, 0, 0.45))",
          mixBlendMode: "screen",
          opacity: 0,
          willChange: "opacity",
          animation: "wrapFlash 2500ms ease-out forwards",
        }}
      />
      {/* Orange inset glow ring */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          boxShadow:
            "inset 0 0 30px #ff7700, inset 0 0 60px rgba(255, 119, 0, 0.55)",
          opacity: 0,
          willChange: "opacity",
          animation: "wrapGlowRing 2500ms ease-in-out forwards",
        }}
      />
      {/* ⏰ emoji wobble — ticking clock */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "40%",
          transform: "translate(-50%, -50%)",
          fontSize: 80,
          lineHeight: 1,
          fontFamily:
            '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
          filter:
            "drop-shadow(0 0 16px rgba(255, 119, 0, 0.85)) drop-shadow(0 4px 14px rgba(0, 0, 0, 0.7))",
          opacity: 0,
          willChange: "transform, opacity",
          animation: "wrapEmojiPulse 2500ms cubic-bezier(0.2, 1.5, 0.4, 1) 100ms forwards",
        }}
      >
        {"\u{23F0}"}
      </div>
      {/* Slam text — Orbitron, orange atmospheric glow */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "65%",
          transform: "translate(-50%, -50%) scale(3) rotate(-2deg)",
          opacity: 0,
          willChange: "transform, opacity",
          animation:
            "wrapSlamText 2500ms cubic-bezier(0.2, 1.5, 0.4, 1) 200ms forwards",
          fontFamily:
            '"Orbitron", system-ui, sans-serif',
          fontWeight: 900,
          fontSize: Math.min(fontSize, 28),
          letterSpacing: 1.5,
          color: "#ffffff",
          textAlign: "center",
          whiteSpace: "nowrap",
          textShadow: [
            "0 0 8px rgba(0,0,0,0.55)",
            "0 0 22px rgba(255,119,0,0.7)",
            "0 0 55px rgba(255,119,0,0.44)",
            "0 0 90px rgba(255,119,0,0.22)",
          ].join(", "),
        }}
      >
        WRAP IT UP!
      </div>
    </div>
  );
});

/**
 * Source aura — gold inset glow ring on the card-player's tile.
 *
 * Renders as a sibling div (matching cardBoxStyle pattern) with a gold
 * inset box-shadow glow ring animated over ~3s (300ms fade in → 2.4s hold
 * → 300ms fade out). Uses the same opacity-keyframe approach as the card
 * animations (StfuCard's glow ring, MicDropCard's glow ring) to keep
 * the visual language consistent — this is a "warm glow" variant, not a
 * separate design system.
 *
 * The gold is universal regardless of which card was played: "gold = this
 * person is active" and the center announcement says "what they played."
 * This avoids colour confusion with the target's per-card animation.
 */
const SourceAura = React.memo(function SourceAura({ tile }: { tile: Tile }) {
  return (
    <div style={cardBoxStyle(tile)}>
      {/* Gold inset glow ring — strong, multi-layer, no border (per Aria spec).
          Opacity cascade: 0.95 → 0.70 → 0.45 → 0.25 from edge to center.
          The sourceAuraGlow keyframe is multiplicative with these values. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          boxShadow: [
            "inset 0 0 25px 4px rgba(255,215,0,0.95)",
            "inset 0 0 55px 8px rgba(255,215,0,0.70)",
            "inset 0 0 100px 12px rgba(255,215,0,0.45)",
            "inset 0 0 150px 16px rgba(255,215,0,0.25)",
          ].join(", "),
          opacity: 0,
          willChange: "opacity",
          animation: "sourceAuraGlow 3000ms ease-in-out forwards",
        }}
      />
    </div>
  );
});

/**
 * Muted tile overlay — grayscale wash + "SILENCED" label.
 *
 * Uses mix-blend-mode: saturation with solid gray (#808080) to push
 * the overlay's 0% saturation onto whatever is beneath it. This is
 * the clever grayscale simulation Aria designed — it works because
 * OBS CEF does composite mix-blend-mode within a single browser source.
 *
 * Layers:
 *   1. Grayscale wash — solid gray with mix-blend-mode: saturation.
 *      Bleeds past tile bounds to cover rounded camera corners.
 *   2. SILENCED label — Orbitron 900 in STFU red, lower third centered.
 *      Animates in with scale + fade via @keyframes silencedLabelIn.
 */
const MutedTileOverlay = React.memo(function MutedTileOverlay({ tile }: { tile: Tile }) {
  const labelSize = Math.max(12, Math.round(tile.w * 0.05));
  const bleed = 8;
  const radius = Math.round(Math.min(tile.w, tile.h) * 0.22);
  return (
    <div style={{
      position: "absolute",
      left: tile.x - bleed,
      top: tile.y - bleed,
      width: tile.w + bleed * 2,
      height: tile.h + bleed * 2,
      pointerEvents: "none",
      // Clip to rounded rect so nothing bleeds past camera tile edges.
      overflow: "hidden",
      borderRadius: radius + bleed,
    }}>
      {/* Grayscale wash — solid gray with mix-blend-mode: saturation.
          This pushes 0% saturation onto whatever is underneath (the
          camera feed), simulating a grayscale filter. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "#808080",
          mixBlendMode: "saturation",
          opacity: 1,
          transition: "opacity 300ms ease-out",
          borderRadius: radius + bleed,
        }}
      />
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
        SILENCED
      </div>
    </div>
  );
});

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

/** ?debug=1 HUD: shows data-channel health (message counts, last-seen, sprite counts). */
function DebugHud({
  snapshot,
  sprites,
}: {
  snapshot: Record<string, { count: number; lastMs: number }>;
  sprites: { emoji: number; card: number; aura: number; muted: number };
}) {
  const now = Date.now();
  const entries = Object.entries(snapshot).sort(([a], [b]) => a.localeCompare(b));
  return (
    <div
      style={{
        position: "fixed",
        top: 8,
        right: 8,
        background: "rgba(0,0,0,0.85)",
        color: "#0f0",
        fontFamily: "monospace",
        fontSize: 11,
        padding: "6px 10px",
        borderRadius: 6,
        lineHeight: 1.6,
        zIndex: 9999,
        pointerEvents: "none",
        border: "1px solid rgba(0,255,0,0.25)",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 2 }}>CHANNEL HEALTH</div>
      {entries.length === 0 && <div style={{ opacity: 0.5 }}>no messages yet</div>}
      {entries.map(([type, { count, lastMs }]) => (
        <div key={type}>
          {type}: {count} · {lastMs ? `${((now - lastMs) / 1000).toFixed(1)}s ago` : "—"}
        </div>
      ))}
      <div style={{ borderTop: "1px solid rgba(0,255,0,0.2)", marginTop: 4, paddingTop: 4 }}>
        sprites: 🎭{sprites.emoji} 🃏{sprites.card} ✨{sprites.aura} 🔇{sprites.muted}
      </div>
    </div>
  );
}

/** Card id → overlay sprite component. */
const CARD_SPRITES: Record<string, React.FC<{ tile: Tile }>> = {
  stfu: StfuCard,
  micdrop: MicDropCard,
  wrapitup: WrapItUpCard,
};

function tileBoxStyle(tile: Tile): CSSProperties {
  // OBS layering handles z-order: overlays cover cams, nameplates/top
  // graphics sit above. We fill the FULL tile area with rounded edges
  // matching VDO.Ninja's own tile chrome.
  const r = Math.round(Math.min(tile.w, tile.h) * 0.22);
  return {
    position: "absolute",
    left: tile.x,
    top: tile.y,
    width: tile.w,
    height: tile.h,
    overflow: "hidden",
    pointerEvents: "none",
    borderRadius: r,
  };
}

/**
 * Card animation box — expanded beyond the tile to prevent glow/shadow
 * clipping. No overflow:hidden or borderRadius so effects can bleed
 * freely; OBS's compositing layer + z-order handles the visual masking.
 */
function cardBoxStyle(tile: Tile): CSSProperties {
  const bleed = 10;
  const r = Math.round(Math.min(tile.w, tile.h) * 0.22);
  return {
    position: "absolute",
    left: tile.x - bleed,
    top: tile.y - bleed,
    width: tile.w + bleed * 2,
    height: tile.h + bleed * 2,
    pointerEvents: "none",
    // Clip to rounded rect so glow/shadow effects don't bleed past
    // the rounded camera tile edges. Inner effect layers use the
    // same radius to stay within bounds.
    overflow: "hidden",
    borderRadius: r + bleed,
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
