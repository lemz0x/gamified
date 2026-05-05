import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useSearchParams } from "react-router-dom";
import { buildChatOnlyUrl, useVdoNinja } from "../lib/vdoninja";
import { useVdoNinjaChat, type ChatMessage } from "../lib/vdoninjaChat";

// ── neon palette (sync with PlayRoute) ──────────────────────────────────

const NEON = {
  bg: "#08080d",
  panelBg: "#0e0e16",
  panelEdge: "#1f1f30",
  text: "#f0f0f8",
  textDim: "#8a8aa3",
  pink: "#ff2e9f",
  purple: "#a855ff",
  cyan: "#22e2ff",
} as const;

// ── known labels we treat as self (don't re-show our own sent messages) ───

function isOwnLabel(localLabel: string, candidate: string): boolean {
  return candidate.trim().toLowerCase() === localLabel.trim().toLowerCase();
}

// ── component ───────────────────────────────────────────────────────────

export function ChatRoute() {
  const [search] = useSearchParams();
  const push = search.get("push") ?? "";
  const label = search.get("label") ?? "Lemz";

  const [messages, setMessages] = useState<readonly ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const chatIdRef = useRef(0);
  const nextChatId = () => `c${chatIdRef.current++}`;

  const onChatIncoming = useCallback(
    (msg: { msg: string; label: string; ts: number }) => {
      // Filter out echos of our own messages — VDO.Ninja sometimes loops them.
      if (isOwnLabel(label, msg.label)) return;
      setMessages((prev) => [
        ...prev,
        { id: nextChatId(), source: "remote", ...msg },
      ]);
    },
    [label],
  );

  const { iframeRef } = useVdoNinja({
    onMessage: (/* ignored — chat-only route, no card/emoji/roster events */) => { },
  });

  const { send: sendChat } = useVdoNinjaChat(iframeRef, onChatIncoming);

  const onSend = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return false;
      const ok = sendChat(trimmed);
      if (ok) {
        setMessages((prev) => [
          ...prev,
          {
            id: nextChatId(),
            source: "local",
            label,
            msg: trimmed,
            ts: Date.now(),
          },
        ]);
      }
      return ok;
    },
    [label, sendChat],
  );

  const iframeSrc = buildChatOnlyUrl({ push, label });

  return (
    <div style={styles.root}>
      {/* ── header ─── */}
      <header style={styles.header}>
        <span style={styles.headerLabel}>{label.toUpperCase()}</span>
        <span style={styles.wordmark}>GAMIFIED</span>
        <LiveIndicator />
      </header>

      {/* ── chat feed ─── */}
      <ChatFeed messages={messages} />

      {/* ── composer ─── */}
      <ChatComposer draft={draft} setDraft={setDraft} onSend={onSend} />

      {/* Hidden VDO.Ninja iframe — keeps the data channel alive */}
      <iframe
        ref={iframeRef}
        src={iframeSrc}
        allow="microphone; camera"
        style={styles.hiddenIframe}
        title="VDO.Ninja data channel"
        aria-hidden="true"
        tabIndex={-1}
      />
    </div>
  );
}

// ── pieces ─────────────────────────────────────────────────────────────────

function LiveIndicator() {
  return (
    <span style={styles.live}>
      <span style={styles.liveDot} />
      LIVE
    </span>
  );
}

interface ChatFeedProps {
  messages: readonly ChatMessage[];
}

function ChatFeed({ messages }: ChatFeedProps) {
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <div ref={listRef} style={styles.chatList}>
      {messages.length === 0 ? (
        <div style={styles.chatEmpty}>Quiet so far — say something.</div>
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
  );
}

interface ChatComposerProps {
  draft: string;
  setDraft: (v: string) => void;
  onSend: (text: string) => boolean;
}

function ChatComposer({ draft, setDraft, onSend }: ChatComposerProps) {
  const submit = () => {
    if (!draft.trim()) return;
    if (onSend(draft)) setDraft("");
  };

  return (
    <div style={styles.composer}>
      <input
        type="text"
        value={draft}
        placeholder="Type a message…"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        style={styles.input}
        spellCheck
      />
      <button
        type="button"
        onClick={submit}
        disabled={!draft.trim()}
        style={{
          ...styles.sendBtn,
          opacity: draft.trim() ? 1 : 0.45,
          cursor: draft.trim() ? "pointer" : "default",
        }}
      >
        Send
      </button>
    </div>
  );
}

// ── styles ────────────────────────────────────────────────────────────────

const styles: Record<string, CSSProperties> = {
  root: {
    position: "fixed",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    background: NEON.panelBg,
    color: NEON.text,
    fontFamily:
      '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
    fontWeight: 700,
    overflow: "hidden",
  },
  header: {
    display: "grid",
    gridTemplateColumns: "1fr auto 1fr",
    alignItems: "center",
    gap: 8,
    padding: "12px 14px 10px",
    borderBottom: `1px solid ${NEON.panelEdge}`,
    flex: "0 0 auto",
  },
  headerLabel: {
    fontSize: 16,
    fontWeight: 800,
    letterSpacing: 1.5,
    color: NEON.cyan,
    textShadow: `0 0 14px ${NEON.cyan}aa`,
    justifySelf: "start",
    whiteSpace: "nowrap",
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
  live: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    letterSpacing: 1.5,
    color: NEON.pink,
    textShadow: `0 0 8px ${NEON.pink}cc`,
    justifySelf: "end",
    whiteSpace: "nowrap",
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: NEON.pink,
    boxShadow: `0 0 10px ${NEON.pink}`,
    animation: "pulseDot 1.4s ease-in-out infinite",
  },
  chatList: {
    flex: "1 1 auto",
    minHeight: 0,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 5,
    padding: "10px 14px",
    fontSize: 15,
    lineHeight: 1.35,
  },
  chatRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    wordBreak: "break-word",
  },
  chatLabel: {
    fontWeight: 800,
    letterSpacing: 0.5,
    flex: "0 0 auto",
  },
  chatBody: {
    color: NEON.text,
    flex: "1 1 auto",
  },
  chatEmpty: {
    fontSize: 12,
    color: NEON.textDim,
    fontStyle: "italic",
    alignSelf: "center",
    marginTop: 20,
    opacity: 0.7,
  },
  composer: {
    flex: "0 0 auto",
    display: "flex",
    alignItems: "stretch",
    gap: 6,
    padding: "10px 14px 12px",
    borderTop: `1px solid ${NEON.panelEdge}`,
  },
  input: {
    appearance: "none",
    flex: "1 1 auto",
    minWidth: 0,
    background: "#13131c",
    border: `1px solid ${NEON.panelEdge}`,
    borderRadius: 10,
    padding: "8px 12px",
    color: NEON.text,
    fontSize: 14,
    fontWeight: 700,
    fontFamily: "inherit",
    outline: "none",
  },
  sendBtn: {
    appearance: "none",
    background: NEON.cyan,
    color: NEON.bg,
    border: 0,
    borderRadius: 10,
    padding: "0 16px",
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 1.2,
    fontFamily: "inherit",
    textTransform: "uppercase",
    transition: "opacity 120ms ease-out",
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
