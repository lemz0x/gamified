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

// ── constants ───────────────────────────────────────────────────────────

/** How long the chat card stays on screen before auto-dismissing. */
const CHAT_SCREEN_MS = 15_000;

/** Sweep interval for pruning expired sprites. */
const SWEEP_INTERVAL_MS = 250;

// ── types ──────────────────────────────────────────────────────────────

interface ChatScreenSprite {
  id: string;
  author: string;
  message: string;
  /** Timestamp after which the sprite auto-dismisses. */
  expiresAt: number;
}

// ── component ──────────────────────────────────────────────────────────

/**
 * Top-layer overlay route — sits above all OBS sources.
 *
 * Connects to VDO.Ninja as a data-only codirector (same as the underlay)
 * and listens for `chatToScreen` / `chatToScreenClear` events. Renders
 * only the ChatScreenCard (for now). Future top-layer elements go here.
 */
export function OverlayRoute() {
  const [chatScreenSprite, setChatScreenSprite] = useState<ChatScreenSprite | null>(null);

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
      setChatScreenSprite((prev) => (prev && prev.expiresAt <= now ? null : prev));
    }, SWEEP_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  const onMessage = useCallback((msg: EventPayload) => {
    switch (msg.type) {
      case "chatToScreen":
        setChatScreenSprite({
          id: nextId(),
          author: msg.author,
          message: msg.message,
          expiresAt: Date.now() + CHAT_SCREEN_MS + 80,
        });
        break;
      case "chatToScreenClear":
        setChatScreenSprite(null);
        break;
    }
  }, []);

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
      {chatScreenSprite && (
        <ChatScreenCard key={chatScreenSprite.id} sprite={chatScreenSprite} />
      )}
    </>
  );
}

// ── ChatScreenCard ──────────────────────────────────────────────────────

const ChatScreenCard = React.memo(function ChatScreenCard({ sprite }: { sprite: ChatScreenSprite }) {
  // Grapheme-aware truncation (200 grapheme safety cap).
  const graphemes = Array.from(sprite.message);
  const display = graphemes.length > 200
    ? graphemes.slice(0, 200).join("") + "\u2026"
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

const glowWrapStyle: CSSProperties = {
  position: "relative",
  display: "inline-flex",
  verticalAlign: "bottom",
  animation: "cardIn 15s cubic-bezier(0.2,1.5,0.4,1) forwards",
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
  maxWidth: 880,
  border: "1.5px solid transparent",
  boxShadow: "0 4px 20px rgba(0,0,0,0.6)",
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
  fontSize: 16,
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