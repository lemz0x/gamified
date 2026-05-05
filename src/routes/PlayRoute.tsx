import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useSearchParams } from "react-router-dom";
import { CARDS, type Card, type CardId } from "../cards";
import { CHAT_EMOJIS, EMOJIS, type Emoji } from "../emojis";
import type { SeatId } from "../coords";
import {
  buildEditorIframeUrl,
  buildHostIframeUrl,
  buildIframeUrl,
  useVdoNinja,
  type EventPayload,
  type EventSender,
} from "../lib/vdoninja";
import { useVdoNinjaChat, type ChatMessage } from "../lib/vdoninjaChat";

// ── seat / role plumbing ─────────────────────────────────────────────────

/** Map ?seat=1..6 to the seat ids used everywhere else (see CLAUDE.md §5). */
const SEAT_ORDER: readonly SeatId[] = ["L1", "L2", "L3", "R1", "R2", "R3"];

function parseSeat(raw: string | null): SeatId | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1 || n > 6) return null;
  return SEAT_ORDER[n - 1] ?? null;
}

const ROSTER_STORAGE_KEY = "gamified.roster.v1";
const CARD_USES_STORAGE_PREFIX = "gamified.cards.uses.";
/**
 * Wrapper-side memo of the highest reset epoch we've ever applied. If a
 * CardResetEvent (or our mount-time getResetEpoch reply) carries a higher
 * epoch, we clear card counters and bump this. That makes resets idempotent
 * AND survive a wrapper refresh — without this the wrapper would simply
 * miss any reset broadcast that fired while it was closed.
 */
const LAST_RESET_SEEN_KEY = "gamified.lastResetSeen.v1";

function loadLastResetSeen(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(LAST_RESET_SEEN_KEY);
    const n = raw == null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function saveLastResetSeen(epoch: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_RESET_SEEN_KEY, String(epoch));
  } catch {
    // ignore
  }
}

function defaultRoster(): Record<SeatId, string> {
  return {
    L1: "Guest 1",
    L2: "Guest 2",
    L3: "Guest 3",
    R1: "Guest 4",
    R2: "Guest 5",
    R3: "Guest 6",
  };
}

function loadRoster(): Record<SeatId, string> {
  if (typeof window === "undefined") return defaultRoster();
  try {
    const raw = window.localStorage.getItem(ROSTER_STORAGE_KEY);
    if (!raw) return defaultRoster();
    const parsed = JSON.parse(raw) as Partial<Record<SeatId, string>> | null;
    if (!parsed || typeof parsed !== "object") return defaultRoster();
    const merged = defaultRoster();
    for (const seat of SEAT_ORDER) {
      const v = parsed[seat];
      if (typeof v === "string" && v.trim()) merged[seat] = v.trim();
    }
    return merged;
  } catch {
    return defaultRoster();
  }
}

function saveRoster(roster: Record<SeatId, string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ROSTER_STORAGE_KEY, JSON.stringify(roster));
  } catch {
    // ignore quota / disabled storage
  }
}

type Identity =
  | { kind: "guest"; seat: SeatId; label: string }
  | { kind: "host"; label: string }
  | { kind: "editor"; label: string };

function cardUsesKey(identity: Identity): string {
  if (identity.kind === "host") return `${CARD_USES_STORAGE_PREFIX}host`;
  if (identity.kind === "editor") return `${CARD_USES_STORAGE_PREFIX}editor`;
  return `${CARD_USES_STORAGE_PREFIX}${identity.seat}`;
}

function loadCardUses(identity: Identity): Record<CardId, number> {
  if (typeof window === "undefined") return { stfu: 0, micdrop: 0 };
  try {
    const raw = window.localStorage.getItem(cardUsesKey(identity));
    if (!raw) return { stfu: 0, micdrop: 0 };
    const parsed = JSON.parse(raw) as Partial<Record<CardId, number>> | null;
    return {
      stfu: typeof parsed?.stfu === "number" ? parsed.stfu : 0,
      micdrop: typeof parsed?.micdrop === "number" ? parsed.micdrop : 0,
    };
  } catch {
    return { stfu: 0, micdrop: 0 };
  }
}

function saveCardUses(
  identity: Identity,
  uses: Record<CardId, number>,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(cardUsesKey(identity), JSON.stringify(uses));
  } catch {
    // ignore
  }
}

function senderFromIdentity(identity: Identity): EventSender {
  if (identity.kind === "guest") {
    return { kind: "guest", seat: identity.seat, label: identity.label };
  }
  // Editor and host both broadcast as "host"-kind so existing overlay/
  // producer code paths (which only switch on guest vs. host) keep
  // working. The label still distinguishes them in feed entries.
  return { kind: "host", label: identity.label };
}

// ── visual constants (gamified neon palette, dark theme) ─────────────────

const NEON = {
  bg: "#08080d",
  panelBg: "#0e0e16",
  panelEdge: "#1f1f30",
  text: "#f0f0f8",
  textDim: "#8a8aa3",
  pink: "#ff2e9f",
  purple: "#a855ff",
  cyan: "#22e2ff",
  red: "#ff2e6b",
  green: "#00d96b",
  amber: "#ffb000",
} as const;

const cardThemes: Record<CardId, { glow: string; edge: string; tint: string }> =
  {
    stfu: { glow: NEON.red, edge: "#ff5482", tint: "rgba(255, 46, 107, 0.12)" },
    micdrop: {
      glow: NEON.green,
      edge: "#22ff7a",
      tint: "rgba(0, 217, 107, 0.12)",
    },
  };

// ── component ────────────────────────────────────────────────────────────

export function PlayRoute() {
  const [search] = useSearchParams();
  const role = search.get("role");
  const isHost = role === "host";
  const isEditor = role === "editor";
  const seat = parseSeat(search.get("seat"));
  const push = search.get("push") ?? "";
  const label =
    search.get("label") ??
    (isHost ? "Host" : isEditor ? "Editor" : "Guest");

  // Memoize so PlaySurface gets a stable identity reference across renders;
  // a fresh object every render would invalidate every downstream useCallback
  // and useMemo that depends on it.
  const identity = useMemo<Identity | null>(
    () =>
      isEditor
        ? { kind: "editor", label }
        : isHost
          ? { kind: "host", label }
          : seat
            ? { kind: "guest", seat, label }
            : null,
    [isEditor, isHost, seat, label],
  );

  if (!identity) {
    return <MissingParamsHelp />;
  }

  return <PlaySurface identity={identity} push={push} />;
}

interface PlaySurfaceProps {
  identity: Identity;
  push: string;
}

function PlaySurface({ identity, push }: PlaySurfaceProps) {
  const [roster, setRoster] = useState<Record<SeatId, string>>(loadRoster);
  const [cardUses, setCardUses] = useState<Record<CardId, number>>(() =>
    loadCardUses(identity),
  );
  const [activeCard, setActiveCard] = useState<Card | null>(null);
  const [emojiPulse, setEmojiPulse] = useState<Emoji | null>(null);
  // Tracked in a ref so the listener can compare without a re-render loop.
  const lastResetSeenRef = useRef<number>(loadLastResetSeen());
  const [chatMessages, setChatMessages] = useState<readonly ChatMessage[]>([]);
  const chatIdRef = useRef(0);
  const nextChatId = () => `c${chatIdRef.current++}`;

  // Memoize callback so the effect inside useVdoNinja doesn't resubscribe.
  const onMessage = useCallback(
    (msg: EventPayload) => {
      switch (msg.type) {
        case "rosterUpdate":
          setRoster(msg.names);
          saveRoster(msg.names);
          break;
        case "cardReset": {
          // Idempotent: only act when the producer's epoch is strictly newer
          // than the highest one we've already applied. A re-broadcast (e.g.
          // in response to our mount-time getResetEpoch) will no-op cleanly.
          if (msg.resetEpoch <= lastResetSeenRef.current) {
            if (import.meta.env.DEV) {
              console.log(
                "[play] ignoring stale cardReset",
                msg.resetEpoch,
                "<= seen",
                lastResetSeenRef.current,
              );
            }
            break;
          }
          lastResetSeenRef.current = msg.resetEpoch;
          saveLastResetSeen(msg.resetEpoch);
          const zero = { stfu: 0, micdrop: 0 };
          setCardUses(zero);
          saveCardUses(identity, zero);
          if (import.meta.env.DEV) {
            console.log("[play] applied cardReset epoch=", msg.resetEpoch);
          }
          break;
        }
        // Other event types (emoji, cardPlay, calibration, getResetEpoch)
        // are for the overlay/producer — the wrapper itself doesn't react.
        default:
          break;
      }
    },
    [identity],
  );

  const { iframeRef, send } = useVdoNinja({ onMessage });

  // On mount, ask the producer to (re)announce the latest reset epoch so
  // we can catch up on any reset broadcast that fired while we were closed.
  // Small delay so the data channel is actually established first.
  useEffect(() => {
    const id = window.setTimeout(() => {
      send({ type: "getResetEpoch", ts: Date.now() });
    }, 1500);
    return () => window.clearTimeout(id);
  }, [send]);

  // Inbound chat lives on a separate channel from `sendData` (see
  // src/lib/vdoninjaChat.ts). Append remote messages to the panel
  // (newest at bottom). Local sends are appended optimistically below
  // because the iframe doesn't reliably echo own messages.
  const onChatIncoming = useCallback(
    (msg: { msg: string; label: string; ts: number }) => {
      setChatMessages((prev) => [
        ...prev,
        { id: nextChatId(), source: "remote", ...msg },
      ]);
    },
    [],
  );
  const { send: sendChat } = useVdoNinjaChat(iframeRef, onChatIncoming);

  const sendChatMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return false;
      const ok = sendChat(trimmed);
      if (ok) {
        setChatMessages((prev) => [
          ...prev,
          {
            id: nextChatId(),
            source: "local",
            label: identity.label,
            msg: trimmed,
            ts: Date.now(),
          },
        ]);
      }
      return ok;
    },
    [identity.label, sendChat],
  );

  const iframeSrc = useMemo(() => {
    if (identity.kind === "host") {
      return buildHostIframeUrl({ push, label: identity.label });
    }
    if (identity.kind === "editor") {
      return buildEditorIframeUrl({ push, label: identity.label });
    }
    return buildIframeUrl({ push, label: identity.label });
  }, [identity, push]);

  // Editors are backstage crew — no cards, no emoji broadcasts. Their
  // panel is chat-only so they can coordinate with the room without
  // appearing in any guest-targetable surface.
  const showCardsAndEmojis = identity.kind !== "editor";

  const fireEmoji = useCallback(
    (emoji: Emoji) => {
      send({
        type: "emoji",
        from: senderFromIdentity(identity),
        emoji,
        ts: Date.now(),
      });
      setEmojiPulse(emoji);
      // Visual feedback window — clears the pulse highlight after the animation.
      window.setTimeout(() => {
        setEmojiPulse((current) => (current === emoji ? null : current));
      }, 250);
    },
    [identity, send],
  );

  const playCard = useCallback(
    (card: Card, target: { seat: SeatId; label: string }) => {
      send({
        type: "cardPlay",
        from: senderFromIdentity(identity),
        cardId: card.id,
        targetSeat: target.seat,
        targetLabel: target.label,
        ts: Date.now(),
      });
      setCardUses((prev) => {
        const next = { ...prev, [card.id]: prev[card.id] + 1 };
        saveCardUses(identity, next);
        return next;
      });
      setActiveCard(null);
    },
    [identity, send],
  );

  // Build the target list — every seat except the local guest. Host
  // and editor are never card-targetable per spec §3.1 (and editor was
  // added in v1.2 with the same crew exclusion). When the local user
  // is host or editor, no seat is theirs, so all six seats appear.
  const targets = useMemo(() => {
    return SEAT_ORDER
      .filter((s) => identity.kind !== "guest" || s !== identity.seat)
      .map((s) => ({ seat: s, label: roster[s] }));
  }, [identity, roster]);

  return (
    <div style={styles.shell}>
      <div style={styles.iframeWrap}>
        <iframe
          ref={iframeRef}
          src={iframeSrc}
          allow="camera; microphone; fullscreen; display-capture; autoplay"
          style={styles.iframe}
          title="VDO.Ninja"
        />
      </div>

      <aside style={styles.panel}>
        <header style={styles.header}>
          <span style={styles.headerLabel}>{identity.label.toUpperCase()}</span>
          <span style={styles.wordmark}>GAMIFIED</span>
          <LiveIndicator />
        </header>

        {showCardsAndEmojis && (
          <>
            <section style={styles.cardRow}>
              {CARDS.map((card) => (
                <CardButton
                  key={card.id}
                  card={card}
                  uses={cardUses[card.id]}
                  onClick={() => setActiveCard(card)}
                />
              ))}
            </section>

            <section style={styles.emojiGrid}>
              {EMOJIS.map((emoji) => (
                <EmojiButton
                  key={emoji}
                  emoji={emoji}
                  pulsing={emojiPulse === emoji}
                  onClick={() => fireEmoji(emoji)}
                />
              ))}
            </section>
          </>
        )}

        <ChatPanel messages={chatMessages} onSend={sendChatMessage} />
      </aside>

      {activeCard && (
        <TargetPickerModal
          card={activeCard}
          targets={targets}
          onPick={(target) => playCard(activeCard, target)}
          onClose={() => setActiveCard(null)}
        />
      )}
    </div>
  );
}

// ── pieces ───────────────────────────────────────────────────────────────

function LiveIndicator() {
  return (
    <span style={styles.live}>
      <span style={styles.liveDot} />
      LIVE
    </span>
  );
}

interface CardButtonProps {
  card: Card;
  uses: number;
  onClick: () => void;
}

function CardButton({ card, uses, onClick }: CardButtonProps) {
  const remaining = card.usesPerTopic - uses;
  const used = remaining <= 0;
  const theme = cardThemes[card.id];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={used}
      style={{
        ...styles.card,
        background: used ? "#15151f" : theme.tint,
        borderColor: used ? "#222230" : theme.edge,
        color: used ? NEON.textDim : NEON.text,
        boxShadow: used ? "none" : `0 0 18px ${theme.glow}66, inset 0 0 24px ${theme.glow}33`,
        opacity: used ? 0.55 : 1,
      }}
    >
      <span style={{ ...styles.cardName, color: used ? NEON.textDim : theme.glow }}>
        {card.name}
      </span>
      <span style={styles.cardCounter}>
        {used
          ? "used"
          : `${remaining} of ${card.usesPerTopic} left · this topic`}
      </span>
    </button>
  );
}

interface EmojiButtonProps {
  emoji: Emoji;
  pulsing: boolean;
  onClick: () => void;
}

function EmojiButton({ emoji, pulsing, onClick }: EmojiButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...styles.emoji,
        transform: pulsing ? "scale(1.15)" : "scale(1)",
        boxShadow: pulsing
          ? `0 0 22px ${NEON.cyan}cc, 0 0 12px ${NEON.pink}99`
          : "0 0 0 1px rgba(255,255,255,0.04)",
        background: pulsing ? "rgba(34, 226, 255, 0.15)" : "#13131c",
      }}
    >
      <span style={styles.emojiGlyph}>{emoji}</span>
    </button>
  );
}

// ── chat panel ───────────────────────────────────────────────────────────

interface ChatPanelProps {
  messages: readonly ChatMessage[];
  onSend: (text: string) => boolean;
}

function ChatPanel({ messages, onSend }: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll the message list to the bottom whenever a new message
  // arrives. Direct scrollTop write — no animation, just stick to bottom.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const submit = () => {
    if (!draft.trim()) return;
    if (onSend(draft)) setDraft("");
  };

  const insertEmoji = (e: string) => {
    const input = inputRef.current;
    if (!input) {
      setDraft((d) => d + e);
      setPickerOpen(false);
      return;
    }
    const start = input.selectionStart ?? draft.length;
    const end = input.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + e + draft.slice(end);
    setDraft(next);
    setPickerOpen(false);
    // Restore caret right after the inserted glyph (next tick to let the
    // controlled input re-render with the new value first).
    requestAnimationFrame(() => {
      input.focus();
      const caret = start + e.length;
      input.setSelectionRange(caret, caret);
    });
  };

  return (
    <section style={styles.chatSection}>
      <div style={styles.chatHeader}>CHAT</div>
      <div ref={listRef} style={styles.chatList}>
        {messages.length === 0 ? (
          <div style={styles.chatEmpty}>
            Quiet so far — say something.
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} style={styles.chatRow}>
              <span
                style={{
                  ...styles.chatLabel,
                  color: m.source === "local" ? NEON.pink : NEON.cyan,
                }}
              >
                {m.source === "local" ? "you" : m.label}
              </span>
              <span style={styles.chatBody}>{m.msg}</span>
            </div>
          ))
        )}
      </div>
      <div style={styles.chatComposerWrap}>
        <div style={styles.chatComposer}>
          <input
            ref={inputRef}
            type="text"
            value={draft}
            placeholder="Type a message…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              } else if (e.key === "Escape" && pickerOpen) {
                setPickerOpen(false);
              }
            }}
            style={styles.chatInput}
            spellCheck
          />
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            aria-label="Emoji picker"
            style={{
              ...styles.chatIconBtn,
              color: pickerOpen ? NEON.cyan : NEON.textDim,
            }}
          >
            {"\u{1F642}"}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!draft.trim()}
            style={{
              ...styles.chatSendBtn,
              opacity: draft.trim() ? 1 : 0.5,
              cursor: draft.trim() ? "pointer" : "default",
            }}
          >
            Send
          </button>
        </div>
        {pickerOpen && (
          <div style={styles.chatPicker} role="menu">
            {CHAT_EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => insertEmoji(e)}
                style={styles.chatPickerBtn}
              >
                {e}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

interface TargetPickerModalProps {
  card: Card;
  targets: ReadonlyArray<{ seat: SeatId; label: string }>;
  onPick: (target: { seat: SeatId; label: string }) => void;
  onClose: () => void;
}

function TargetPickerModal({
  card,
  targets,
  onPick,
  onClose,
}: TargetPickerModalProps) {
  const theme = cardThemes[card.id];
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={styles.modalScrim}
      onClick={onClose}
    >
      <div style={styles.modalPanel} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <span style={{ ...styles.modalKicker, color: theme.glow }}>
            Play card on…
          </span>
          <span
            style={{
              ...styles.modalTitle,
              color: theme.glow,
              textShadow: `0 0 18px ${theme.glow}aa`,
            }}
          >
            {card.name}
          </span>
        </div>

        <div style={styles.targetGrid}>
          {targets.map((t) => (
            <button
              key={t.seat}
              type="button"
              onClick={() => onPick(t)}
              style={{
                ...styles.targetButton,
                borderColor: theme.edge,
                boxShadow: `0 0 14px ${theme.glow}55, inset 0 0 28px ${theme.glow}22`,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <button type="button" onClick={onClose} style={styles.modalCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function MissingParamsHelp() {
  return (
    <div style={styles.shell}>
      <div style={{ ...styles.iframeWrap, ...styles.helpBox }}>
        <h1 style={{ color: NEON.pink, marginBottom: 8 }}>Missing URL params</h1>
        <p style={{ color: NEON.textDim, maxWidth: 520, lineHeight: 1.5 }}>
          The /play wrapper needs <code>?seat=1..6&amp;push=&lt;id&gt;&amp;label=&lt;name&gt;</code>{" "}
          for guests, <code>?role=host&amp;push=&lt;id&gt;&amp;label=&lt;name&gt;</code> for the
          host, or <code>?role=editor&amp;push=&lt;id&gt;&amp;label=&lt;name&gt;</code> for
          the editor (chat-only, audio publish).
        </p>
      </div>
    </div>
  );
}

// ── styles ───────────────────────────────────────────────────────────────

const styles: Record<string, CSSProperties> = {
  shell: {
    display: "flex",
    width: "100vw",
    height: "100vh",
    background: NEON.bg,
    color: NEON.text,
    fontFamily:
      '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
  },
  iframeWrap: {
    flex: "0 0 80%",
    height: "100%",
    background: "#000",
    position: "relative",
  },
  iframe: {
    width: "100%",
    height: "100%",
    border: 0,
    display: "block",
  },
  panel: {
    flex: "0 0 20%",
    minWidth: 260,
    height: "100%",
    background: NEON.panelBg,
    borderLeft: `1px solid ${NEON.panelEdge}`,
    boxShadow: `inset 8px 0 32px ${NEON.purple}22`,
    display: "flex",
    flexDirection: "column",
    padding: "16px 14px",
    gap: 14,
    boxSizing: "border-box",
    overflowY: "auto",
  },
  header: {
    // Three-cell grid keeps the wordmark perfectly centered regardless
    // of how wide the guest label or LIVE indicator render.
    display: "grid",
    gridTemplateColumns: "1fr auto 1fr",
    alignItems: "center",
    gap: 8,
    paddingBottom: 10,
    borderBottom: `1px solid ${NEON.panelEdge}`,
  },
  headerLabel: {
    fontSize: 16,
    fontWeight: 800,
    letterSpacing: 1.5,
    color: NEON.cyan,
    textShadow: `0 0 14px ${NEON.cyan}aa`,
    justifySelf: "start",
  },
  live: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    letterSpacing: 1.5,
    color: NEON.pink,
    textShadow: `0 0 8px ${NEON.pink}cc`,
    justifySelf: "end",
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: NEON.pink,
    boxShadow: `0 0 10px ${NEON.pink}`,
    animation: "pulseDot 1.4s ease-in-out infinite",
  },
  cardRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
  },
  card: {
    appearance: "none",
    border: "1px solid",
    borderRadius: 12,
    padding: "18px 14px",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    alignItems: "center",
    transition:
      "transform 80ms ease-out, box-shadow 120ms ease-out, opacity 120ms ease-out",
    fontFamily: "inherit",
  },
  cardName: {
    fontSize: 15,
    fontWeight: 800,
    letterSpacing: 0.6,
    textAlign: "center",
    lineHeight: 1.15,
  },
  cardCounter: {
    fontSize: 10,
    letterSpacing: 0.5,
    color: NEON.textDim,
    textAlign: "center",
  },
  emojiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(5, 1fr)",
    gap: 8,
  },
  emoji: {
    appearance: "none",
    border: 0,
    background: "#13131c",
    borderRadius: 10,
    aspectRatio: "1 / 1",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition:
      "transform 120ms ease-out, box-shadow 180ms ease-out, background 180ms ease-out",
    fontFamily: "inherit",
  },
  emojiGlyph: {
    fontSize: 22,
    lineHeight: 1,
  },
  // ── chat panel ────────────────────────────────────────────────────────
  chatSection: {
    // Take all remaining vertical space below cards + emojis. The panel
    // itself is `display:flex; flex-direction:column`, so flex:1 here
    // makes the chat list expand instead of overflowing the viewport.
    flex: "1 1 auto",
    minHeight: 200,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    paddingTop: 8,
    borderTop: `1px solid ${NEON.panelEdge}`,
  },
  chatHeader: {
    fontSize: 10,
    letterSpacing: 2,
    fontWeight: 800,
    color: NEON.textDim,
    textTransform: "uppercase",
  },
  chatList: {
    flex: "1 1 auto",
    minHeight: 80,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "4px 2px 4px 0",
  },
  chatRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    fontSize: 15,
    lineHeight: 1.35,
  },
  chatLabel: {
    fontWeight: 800,
    letterSpacing: 0.5,
    flex: "0 0 auto",
  },
  chatBody: {
    color: NEON.text,
    overflowWrap: "anywhere",
    flex: "1 1 auto",
  },
  chatEmpty: {
    fontSize: 11,
    color: NEON.textDim,
    fontStyle: "italic",
  },
  chatComposerWrap: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  chatComposer: {
    display: "flex",
    alignItems: "stretch",
    gap: 4,
  },
  chatInput: {
    appearance: "none",
    flex: "1 1 auto",
    minWidth: 0,
    background: "#13131c",
    border: `1px solid ${NEON.panelEdge}`,
    borderRadius: 8,
    padding: "7px 10px",
    color: NEON.text,
    fontSize: 13,
    fontFamily: "inherit",
    outline: "none",
  },
  chatIconBtn: {
    appearance: "none",
    background: "#13131c",
    border: `1px solid ${NEON.panelEdge}`,
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 16,
    width: 32,
    fontFamily: "inherit",
  },
  chatSendBtn: {
    appearance: "none",
    background: NEON.cyan,
    color: NEON.bg,
    border: 0,
    borderRadius: 8,
    padding: "0 12px",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: 1.2,
    fontFamily: "inherit",
    textTransform: "uppercase",
  },
  chatPicker: {
    position: "absolute",
    bottom: "calc(100% + 6px)",
    right: 0,
    background: NEON.panelBg,
    border: `1px solid ${NEON.panelEdge}`,
    borderRadius: 10,
    padding: 6,
    boxShadow: `0 8px 22px rgba(0,0,0,0.55), 0 0 18px ${NEON.purple}33`,
    display: "grid",
    gridTemplateColumns: "repeat(5, 1fr)",
    gap: 4,
    zIndex: 20,
  },
  chatPickerBtn: {
    appearance: "none",
    background: "transparent",
    border: 0,
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 18,
    width: 32,
    height: 32,
    fontFamily: "inherit",
  },
  wordmark: {
    fontSize: 13,
    letterSpacing: 3,
    fontWeight: 800,
    background: `linear-gradient(90deg, ${NEON.pink}, ${NEON.purple} 50%, ${NEON.cyan})`,
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
    justifySelf: "center",
    whiteSpace: "nowrap",
  },
  modalScrim: {
    position: "fixed",
    inset: 0,
    background: "rgba(4, 4, 12, 0.86)",
    backdropFilter: "blur(6px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 50,
    padding: 24,
  },
  modalPanel: {
    width: "min(640px, 100%)",
    background: NEON.panelBg,
    border: `1px solid ${NEON.panelEdge}`,
    borderRadius: 18,
    padding: "28px 24px",
    display: "flex",
    flexDirection: "column",
    gap: 22,
  },
  modalHeader: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    alignItems: "center",
    textAlign: "center",
  },
  modalKicker: {
    fontSize: 12,
    letterSpacing: 3,
    fontWeight: 700,
    textTransform: "uppercase",
  },
  modalTitle: {
    fontSize: 28,
    letterSpacing: 1,
    fontWeight: 900,
  },
  targetGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 12,
  },
  targetButton: {
    appearance: "none",
    background: "rgba(255,255,255,0.02)",
    border: "1px solid",
    borderRadius: 12,
    padding: "16px 12px",
    fontSize: 18,
    fontWeight: 800,
    letterSpacing: 0.6,
    color: NEON.text,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  modalCancel: {
    appearance: "none",
    background: "transparent",
    border: `1px solid ${NEON.panelEdge}`,
    borderRadius: 10,
    padding: "10px 16px",
    color: NEON.textDim,
    fontSize: 13,
    letterSpacing: 1.5,
    cursor: "pointer",
    alignSelf: "center",
    fontFamily: "inherit",
  },
  helpBox: {
    flex: "1 1 auto",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    textAlign: "center",
    gap: 10,
  },
};
