import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useSearchParams } from "react-router-dom";
import { buildChatOnlyUrl, useVdoNinja } from "../lib/vdoninja";
import { useVdoNinjaChat, type ChatMessage } from "../lib/vdoninjaChat";
import { CHAT_EMOJIS } from "../emojis";
import { findColonToken, tryAutoInsert, replaceAllColonTokens, emojiShorthand, type ColonMatch } from "../lib/emojiAliases";

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

interface ChatRouteProps {
  defaultLabel?: string;
}

export function ChatRoute({ defaultLabel = "Lemz" }: ChatRouteProps) {
  const [search] = useSearchParams();
  const push = search.get("push") ?? "";
  const label = search.get("label") ?? defaultLabel;

  const [messages, setMessages] = useState<readonly ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const chatIdRef = useRef(0);
  const nextChatId = () => `c${chatIdRef.current++}`;

  const onChatIncoming = useCallback(
    (msg: { msg: string; label: string; ts: number }) => {
      // Filter out echos of our own messages — VDO.Ninja sometimes loops them.
      if (isOwnLabel(label, msg.label)) return;
      setMessages((prev) => {
        const next = [...prev, { id: nextChatId(), source: "remote" as const, ...msg }];
        return next.length > 300 ? next.slice(-300) : next;
      });
    },
    [label],
  );

  const { iframeRef, send } = useVdoNinja({
    onMessage: (/* ignored — chat-only route, no card/emoji/roster events */) => { },
  });

  const { send: sendChat } = useVdoNinjaChat(iframeRef, onChatIncoming);

  const onSend = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return false;
      const ok = sendChat(trimmed);
      if (ok) {
        setMessages((prev) => {
          const next = [...prev, {
            id: nextChatId(),
            source: "local" as const,
            label,
            msg: trimmed,
            ts: Date.now(),
          }];
          return next.length > 300 ? next.slice(-300) : next;
        });
      }
      return ok;
    },
    [label, sendChat],
  );

  const featureMessage = useCallback(
    (msg: ChatMessage) => {
      const sanitized = msg.msg
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
        .replace(/[\u200B-\u200F\uFEFF]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (!sanitized) return;
      send({ type: "chatToScreen", author: msg.label, message: sanitized, ts: Date.now() });
    },
    [send],
  );

  const clearChatScreen = useCallback(() => {
    send({ type: "chatToScreenClear", ts: Date.now() });
  }, [send]);

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
      <ChatFeed messages={messages} onFeature={featureMessage} />

      {/* ── composer with emoji picker ─── */}
      <ChatComposer draft={draft} setDraft={setDraft} onSend={onSend} />

      {/* ── clear from screen ─── */}
      <button
        type="button"
        onClick={clearChatScreen}
        style={{
          background: "transparent",
          color: "#ff5454",
          border: "1px solid #ff5454",
          borderRadius: 6,
          padding: "6px 12px",
          fontSize: 10,
          fontWeight: 800,
          textTransform: "uppercase",
          cursor: "pointer",
          margin: "0 14px 10px",
          letterSpacing: 0.5,
        }}
      >
        Clear from Screen
      </button>

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
  onFeature?: (msg: ChatMessage) => void;
}

function ChatFeed({ messages, onFeature }: ChatFeedProps) {
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
          <div key={m.id} style={{ ...styles.chatRow, gap: 6 }}>
            <span
              style={{
                ...styles.chatLabel,
                color: m.source === "local" ? NEON.pink : NEON.cyan,
              }}
            >
              {m.source === "local" ? "you" : m.label}
            </span>
            <span style={styles.chatBody}>{m.msg}</span>
            {onFeature && (
              <button
                type="button"
                onClick={() => onFeature(m)}
                style={{
                  background: "transparent",
                  color: NEON.pink,
                  border: `1px solid ${NEON.pink}55`,
                  borderRadius: 4,
                  padding: "3px 8px",
                  fontSize: 11,
                  fontWeight: 800,
                  textTransform: "uppercase",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                  lineHeight: 1.3,
                }}
              >
                Feature
              </button>
            )}
          </div>
        ))
      )}
    </div>
  );
}

interface ChatComposerProps {
  draft: string;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  onSend: (text: string) => boolean;
}

function ChatComposer({ draft, setDraft, onSend }: ChatComposerProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [colonMatch, setColonMatch] = useState<ColonMatch | null>(null);
  const [colonHighlight, setColonHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const submit = () => {
    const processed = replaceAllColonTokens(draft);
    if (!processed.trim()) return;
    if (onSend(processed)) {
      setDraft("");
      setColonMatch(null);
    }
  };

  const insertEmoji = (e: string) => {
    const input = inputRef.current;
    if (!input) {
      setDraft((d: string) => d + e);
      return;
    }
    const start = input.selectionStart ?? draft.length;
    const end = input.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + e + draft.slice(end);
    setDraft(next);
    requestAnimationFrame(() => {
      input.focus();
      const caret = start + e.length;
      input.setSelectionRange(caret, caret);
    });
  };

  const insertColonEmoji = (emoji: string, match: ColonMatch) => {
    const input = inputRef.current;
    const before = draft.slice(0, match.start);
    const after = draft.slice(match.end);
    const next = before + emoji + after;
    setDraft(next);
    setColonMatch(null);
    setColonHighlight(0);
    if (input) {
      const caret = match.start + emoji.length;
      requestAnimationFrame(() => {
        input.focus();
        input.setSelectionRange(caret, caret);
      });
    }
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = e.target;
    const newVal = el.value;
    const cursorPos = el.selectionStart ?? newVal.length;

    if (cursorPos > 0 && !/[a-zA-Z0-9]/.test(newVal[cursorPos - 1])) {
      const result = tryAutoInsert(newVal, cursorPos);
      if (result) {
        setDraft(result.text);
        setColonMatch(null);
        setColonHighlight(0);
        if (inputRef.current) {
          requestAnimationFrame(() => {
            inputRef.current?.focus();
            inputRef.current?.setSelectionRange(result.cursorPos, result.cursorPos);
          });
        }
        return;
      }
    }

    setDraft(newVal);
    const match = findColonToken(newVal, cursorPos);
    setColonMatch(match && match.suggestions.length > 0 ? match : null);
    setColonHighlight(0);
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (colonMatch && colonMatch.suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setColonHighlight((h) => (h + 1) % colonMatch.suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setColonHighlight((h) => h === 0 ? colonMatch.suggestions.length - 1 : h - 1);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && colonMatch.suggestions.length > 0)) {
        e.preventDefault();
        const suggestion = colonMatch.suggestions[colonHighlight];
        insertColonEmoji(suggestion.emoji, colonMatch);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setColonMatch(null);
        return;
      }
    }

    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape" && pickerOpen) {
      setPickerOpen(false);
    }
  };

  return (
    <div style={styles.composerWrap}>
      {colonMatch && colonMatch.suggestions.length > 0 && (
        <div style={styles.colonPicker}>
          {colonMatch.suggestions.map((s, i) => (
            <button
              key={`${s.alias}-${i}`}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                insertColonEmoji(s.emoji, colonMatch);
              }}
              style={{
                ...styles.colonPickerBtn,
                background: i === colonHighlight ? `${NEON.cyan}22` : "transparent",
                borderColor: i === colonHighlight ? `${NEON.cyan}55` : "transparent",
              }}
            >
              <span style={styles.colonPickerEmoji}>{s.emoji}</span>
              <span style={styles.colonPickerAlias}>:{s.alias}</span>
            </button>
          ))}
        </div>
      )}
      <div style={styles.composer}>
        <input
          ref={inputRef}
          type="text"
          value={draft}
          placeholder="Type a message... use : for emojis"
          onChange={onInputChange}
          onKeyDown={onInputKeyDown}
          style={styles.input}
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
            ...styles.sendBtn,
            opacity: draft.trim() ? 1 : 0.45,
            cursor: draft.trim() ? "pointer" : "default",
          }}
        >
          Send
        </button>
      </div>
      {pickerOpen && (
        <div style={styles.chatPicker} role="menu">
          <button
            type="button"
            onClick={() => setPickerOpen(false)}
            aria-label="Close emoji picker"
            style={{
              position: "absolute",
              top: 4,
              right: 6,
              appearance: "none",
              background: "transparent",
              border: 0,
              color: NEON.textDim,
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 700,
              lineHeight: 1,
              padding: "2px 4px",
              fontFamily: "inherit",
              zIndex: 1,
            }}
          >
            {"\u2715"}
          </button>
          {CHAT_EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => insertEmoji(e)}
              title={emojiShorthand(e) ? `:${emojiShorthand(e)}` : undefined}
              style={styles.chatPickerBtn}
            >
              {e}
            </button>
          ))}
        </div>
      )}
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
  composerWrap: {
    flex: "0 0 auto",
    position: "relative",
  },
  composer: {
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
  chatIconBtn: {
    appearance: "none",
    background: "transparent",
    border: 0,
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 18,
    width: 32,
    fontFamily: "inherit",
    transition: "color 120ms ease-out",
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
  chatPicker: {
    position: "absolute",
    bottom: "calc(100% + 6px)",
    right: 14,
    background: NEON.panelBg,
    border: `1px solid ${NEON.panelEdge}`,
    borderRadius: 10,
    padding: 6,
    paddingTop: 20,
    boxShadow: `0 8px 22px rgba(0,0,0,0.55), 0 0 18px ${NEON.purple}33`,
    display: "grid",
    gridTemplateColumns: "repeat(6, 1fr)",
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
  colonPicker: {
    position: "absolute",
    bottom: "calc(100% + 4px)",
    left: 0,
    right: 0,
    background: NEON.panelBg,
    border: `1px solid ${NEON.panelEdge}`,
    borderRadius: 8,
    padding: 4,
    boxShadow: `0 8px 22px rgba(0,0,0,0.55), 0 0 12px ${NEON.cyan}22`,
    display: "flex",
    flexDirection: "column",
    gap: 2,
    zIndex: 20,
    maxHeight: 200,
    overflowY: "auto",
  },
  colonPickerBtn: {
    appearance: "none",
    background: "transparent",
    border: "1px solid transparent",
    borderRadius: 6,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "4px 8px",
    fontFamily: "inherit",
    textAlign: "left" as const,
  },
  colonPickerEmoji: {
    fontSize: 18,
    lineHeight: 1,
    flexShrink: 0,
  },
  colonPickerAlias: {
    fontSize: 11,
    color: NEON.textDim,
    fontWeight: 600,
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