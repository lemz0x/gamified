import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  buildOverlayDataOnlyUrl,
  useVdoNinja,
  type EventPayload,
} from "../lib/vdoninja";
import { useSearchParams } from "react-router-dom";
import {
  loadCalibratedHostTile,
  loadCalibratedTiles,
  resolveLayout,
  resolveTileSet,
  type GuestLayout,
  type SeatId,
  type TileMap,
} from "../coords";
import type { CardId } from "../cards";
import { R5PlayedCard } from "../components/R5CardFx";
import { MutedTileOverlay } from "../components/MutedTileOverlay";

// ── constants ───────────────────────────────────────────────────────────

/** How long the chat card stays on screen before auto-dismissing. */
const CHAT_SCREEN_MS = 15_000;

/** Duration of the fade-out animation when a message is cleared early. */
const CLEAR_FADE_MS = 400;

/** Sweep interval for pruning expired sprites. */
const SWEEP_INTERVAL_MS = 250;

/**
 * STFU-on-Sam: how long the SILENCED treatment paints over Sam's tile.
 * Must match SAM_STFU_MS in PlayRoute (the hard-lock window).
 */
const SAM_STFU_MS = 10_000;

/**
 * Round 5 played card (`?set=r5`): how long it stays beside the player's
 * camera. STFU lasts the whole 10 s mute; the others 4.5 s. Then it leaves
 * over 380 ms.
 */
const R5_CARD_HOLD_MS: Record<CardId, number> = { stfu: 10_000, wrapitup: 4_500, micdrop: 4_500 };
const R5_CARD_AWAY_MS = 380;
/** Same burst cap idea as the underlay's card sprites. */
const R5_CARD_CAP = 4;

// ── types ──────────────────────────────────────────────────────────────

interface ChatScreenSprite {
  id: string;
  author: string;
  message: string;
  /** Timestamp after which the sprite auto-dismisses. */
  expiresAt: number;
  /** When true, a fade-out animation plays before removal. */
  cleared?: boolean;
}

interface PlayedCardSprite {
  id: string;
  cardId: CardId;
  seat: SeatId;
  layout: GuestLayout;
  holdMs: number;
  expiresAt: number;
}

// ── component ──────────────────────────────────────────────────────────

/**
 * Top-layer overlay route — sits above all OBS sources.
 *
 * Connects to VDO.Ninja as a data-only codirector (same as the underlay)
 * and listens for `chatToScreen` / `chatToScreenClear` events plus
 * `samStfu` (Sam's SILENCED wash paints ABOVE his camera here; the
 * underlay paints the below-camera copy). Future top-layer elements go
 * here.
 */
export function OverlayRoute() {
  const [search] = useSearchParams();
  const [chatScreenSprite, setChatScreenSprite] = useState<ChatScreenSprite | null>(null);

  // Round 5 set only (`?set=r5`): the played card beside the player's camera.
  // There is one Overlay source for both the 4- and 6-guest scenes, so the
  // layout comes from `?layout=` (default 6), and any event naming seat L3 or
  // R3 is six-guest by definition. Tiles use the same per-machine calibration
  // the underlay saves (same OBS browser profile).
  const r5 = resolveTileSet(search.get("set")) === "r5";
  const urlLayout: GuestLayout = resolveLayout(search.get("layout"));
  const [r5Tiles, setR5Tiles] = useState<Record<GuestLayout, TileMap>>(() => ({
    "6": loadCalibratedTiles("6", "r5"),
    "4": loadCalibratedTiles("4", "r5"),
  }));
  const [playedCards, setPlayedCards] = useState<readonly PlayedCardSprite[]>([]);

  // STFU-on-Sam: SILENCED treatment over Sam's tile. The overlay sits ABOVE
  // Sam Cam in every show scene (unlike the underlay, which is below him —
  // the Sept 30 test showed the underlay wash painting "behind" his cam).
  // Tile resolved once on mount; host calibration is per-machine like guests.
  const samTile = useMemo(loadCalibratedHostTile, []);
  const [samSilenced, setSamSilenced] = useState(false);
  const samSilenceTimeoutRef = useRef<number | null>(null);

  // Clear the pending silence timer on unmount (OBS source shutdown).
  useEffect(() => {
    return () => {
      if (samSilenceTimeoutRef.current !== null) {
        window.clearTimeout(samSilenceTimeoutRef.current);
      }
    };
  }, []);

  const idCounter = useRef(0);
  const nextId = () => `${Date.now().toString(36)}-${(idCounter.current++).toString(36)}`;

  // Make the body fully transparent so OBS only composites our sprites.
  useEffect(() => {
    document.body.classList.add("overlay-route");
    return () => {
      document.body.classList.remove("overlay-route");
    };
  }, []);

  // Own sweep interval — separate from UnderlayRoute's.
  // Prunes expired chat screen sprites via functional setter (no stale closure).
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = Date.now();
      setChatScreenSprite((prev) =>
        prev && prev.expiresAt <= now ? null : prev,
      );
      setPlayedCards((prev) => {
        const next = prev.filter((c) => c.expiresAt > now);
        return next.length === prev.length ? prev : next;
      });
    }, SWEEP_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  // When a message is cleared early, remove it after the fade-out completes.
  useEffect(() => {
    if (!chatScreenSprite?.cleared) return;
    const id = window.setTimeout(
      () => setChatScreenSprite(null),
      CLEAR_FADE_MS,
    );
    return () => window.clearTimeout(id);
  }, [chatScreenSprite]);

  const onMessage = useCallback((msg: EventPayload) => {
    switch (msg.type) {
      case "cardPlay": {
        // Classic set: the overlay ignores card plays, as before.
        // The host and Lemz have no camera, so their cards show no played card.
        if (!r5 || msg.from.kind !== "guest") break;
        const seat = msg.from.seat;
        const six = seat === "L3" || seat === "R3" || msg.targetSeat === "L3" || msg.targetSeat === "R3";
        const holdMs = R5_CARD_HOLD_MS[msg.cardId] ?? 4_500;
        const sprite: PlayedCardSprite = {
          id: nextId(),
          cardId: msg.cardId,
          seat,
          layout: six ? "6" : urlLayout,
          holdMs,
          expiresAt: Date.now() + holdMs + R5_CARD_AWAY_MS + 80,
        };
        // One card per player: a new play from the same seat replaces the old one.
        setPlayedCards((prev) => [...prev.filter((c) => c.seat !== seat).slice(-(R5_CARD_CAP - 1)), sprite]);
        break;
      }
      case "calibration":
        // Producer nudged the r5 tiles. The event does not say which layout it is
        // for, so re-read both maps from the calibration the producer and the
        // underlays save on this machine, once they have written it.
        if (!r5 || msg.set !== "r5") break;
        window.setTimeout(() => setR5Tiles({ "6": loadCalibratedTiles("6", "r5"), "4": loadCalibratedTiles("4", "r5") }), 300);
        break;
      case "chatToScreen":
        setChatScreenSprite({
          id: nextId(),
          author: msg.author,
          message: msg.message,
          expiresAt: Date.now() + CHAT_SCREEN_MS + 80,
        });
        break;
      case "chatToScreenClear":
        // Mark for fade-out instead of yanking instantly.
        setChatScreenSprite((prev) =>
          prev ? { ...prev, cleared: true } : null,
        );
        break;
      case "samStfu":
        // STFU-on-Sam landed: paint SILENCED over Sam for the hard-lock
        // window. Clear any pending timeout so stacked votes (impossible
        // today — cooldown blocks them — but future-proof) extend, not cut.
        setSamSilenced(true);
        if (samSilenceTimeoutRef.current !== null) {
          window.clearTimeout(samSilenceTimeoutRef.current);
        }
        samSilenceTimeoutRef.current = window.setTimeout(() => {
          setSamSilenced(false);
          samSilenceTimeoutRef.current = null;
        }, SAM_STFU_MS);
        break;
    }
  }, [r5, urlLayout]);

  // Hidden VDO.Ninja data-only codirector iframe.
  const overlayUrl = useMemo(() => buildOverlayDataOnlyUrl(), []);
  const { iframeRef } = useVdoNinja({ onMessage });

  return (
    <>
      <iframe
        ref={iframeRef}
        src={overlayUrl}
        style={hiddenIframe}
        allow="autoplay; camera; microphone"
        title="data-channel"
      />
      {samSilenced && <MutedTileOverlay tile={samTile} variant="host" />}
      {playedCards.map((c) => (
        <R5PlayedCard key={c.id} card={c.cardId} tile={r5Tiles[c.layout][c.seat]} holdMs={c.holdMs} />
      ))}
      {chatScreenSprite && (
        <div
          // Key the wrapper (not just the card) on the sprite id: React reuses
          // an unkeyed wrapper across replaces, so the 15s fadeInOut keeps
          // running on the first message's clock - a second featured chat
          // fades on the first one's timer, and a third inside that window
          // never appears (animation already finished at opacity 0).
          // A fresh wrapper per sprite gives each message its own full fade.
          key={chatScreenSprite.id}
          style={
            chatScreenSprite.cleared
              ? { ...fadeWrapStyle, animation: `fadeOut ${CLEAR_FADE_MS}ms ease-out forwards` }
              : fadeWrapStyle
          }
        >
          <div style={ambientFeatherStyle} />
          <ChatScreenCard sprite={chatScreenSprite} />
        </div>
      )}
    </>
  );
}

// ── ChatScreenCard ──────────────────────────────────────────────────────

const ChatScreenCard = React.memo(function ChatScreenCard({ sprite }: { sprite: ChatScreenSprite }) {
  // Grapheme-aware truncation (300 grapheme safety cap).
  const graphemes = Array.from(sprite.message);
  const display = graphemes.length > 300
    ? graphemes.slice(0, 300).join("") + "\u2026"
    : sprite.message;

  return (
    <div style={cardPosStyle}>
      <div
        className="glow-wrap"
        style={glowWrapStyle}
      >
        <div className="glow-ring" style={glowRingStyle} />
        <div style={chatCardStyle}>
          <div style={logoLeftStyle}>
            <img
              src="/gamified-logo-left.png"
              alt="Gamified"
              style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
            />
          </div>
          <div style={contentStyle}>
            <div style={authorStyle}>
              {sprite.author}
            </div>
            <div style={messageStyle}>
              {display}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

// ── styles ──────────────────────────────────────────────────────────────

const hiddenIframe: CSSProperties = {
  position: "fixed",
  width: 0,
  height: 0,
  border: "none",
  left: -9999,
  top: -9999,
};

const cardPosStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 14,
  zIndex: 60,
  pointerEvents: "none",
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "center",
  padding: "0 14px",
};

const fadeWrapStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 54,
  pointerEvents: "none",
  animation: `fadeInOut ${CHAT_SCREEN_MS}ms ease-in-out forwards`,
};

const glowWrapStyle: CSSProperties = {
  position: "relative",
  display: "inline-flex",
  verticalAlign: "bottom",
};

const glowRingStyle: CSSProperties = {
  position: "absolute",
  inset: -3,
  borderRadius: 16,
  zIndex: -1,
  overflow: "hidden",
};

const chatCardStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  padding: "14px 20px",
  borderRadius: 16,
  background: "rgba(6,4,12,0.97)",
  maxWidth: 1100,
  border: "1.5px solid transparent",
  boxShadow: "0 4px 24px rgba(0,0,0,0.8), 0 0 80px rgba(0,0,0,0.5)",
};

/** Ambient backdrop: wide, low-opacity gradient across the full bottom.
 *  Feathered edges. The card itself (rgba(6,4,12,0.97) + box-shadow)
 *  handles its own readability. No separate pill layer needed. */

const ambientFeatherStyle: CSSProperties = {
  position: "fixed",
  left: 0,
  right: 0,
  bottom: 0,
  height: 280,
  background:
    "radial-gradient(ellipse 1400px 240px at 50% 100%, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.22) 50%, transparent 80%)",
  pointerEvents: "none",
};

const logoLeftStyle: CSSProperties = {
  width: 64,
  height: 64,
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const contentStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 1,
  minWidth: 0,
};

const authorStyle: CSSProperties = {
  fontFamily: '"Orbitron", sans-serif',
  fontWeight: 900,
  fontSize: 22,
  letterSpacing: 2,
  color: "#22e2ff",
  textTransform: "uppercase",
};

const messageStyle: CSSProperties = {
  fontFamily: '"Inter", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", system-ui, sans-serif',
  fontWeight: 700,
  fontSize: 26,
  color: "#f0f0f8",
  lineHeight: 1.3,
  wordBreak: "break-word",
  display: "-webkit-box",
  WebkitLineClamp: 3,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};