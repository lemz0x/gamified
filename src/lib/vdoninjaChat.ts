/**
 * VDO.Ninja IFRAME chat plumbing.
 *
 * Chat rides VDO.Ninja's *built-in* chat infrastructure (server-relayed
 * websocket), NOT our `sendData` P2P data channel. We piggy-back on the
 * iframe's existing chat so the wrapper's chat panel is just an
 * alternate UI for the same conversation guests can already see via the
 * native in-iframe chat button (which we deliberately do not hide).
 *
 * Outbound: parent → iframe.
 *   { sendChat: <text> }
 *
 * Inbound: iframe → parent (whenever a chat message arrives in the room).
 *   event.data.action === 'incoming-chat'
 *     event.data.value = { msg, label, type, ts }
 *
 * In real builds, VDO.Ninja's `msg` field arrives as a pre-rendered
 * HTML *fragment* like:
 *   "<b><span class='chat_name'>Gnoc</span>:</b> hello"
 * — i.e. the iframe has already styled the sender name. We parse that
 * shape out into structured `{ label, msg }` so React can render the
 * pieces with our own neon styling. All HTML is stripped from the body
 * before it hits a React text node — never use `dangerouslySetInnerHTML`
 * on iframe-supplied content.
 *
 * Reference: https://docs.vdo.ninja/guides/iframe-api-documentation
 */

import { useCallback, useEffect, useRef, type RefObject } from "react";

export interface ChatMessage {
  /** Stable id used as the React key for the message list. */
  id: string;
  /** Display name VDO.Ninja attached (the sender's `&label=`). */
  label: string;
  /** The message text — guaranteed plain text (HTML stripped on parse). */
  msg: string;
  /** Wall-clock timestamp the wrapper saw the message (ms). */
  ts: number;
  /**
   * `local` = sent by this wrapper via `sendChat`. We optimistically
   * append local sends to the panel without waiting for an echo, since
   * VDO.Ninja's iframe doesn't reliably reflect our own messages.
   */
  source: "local" | "remote";
}

// ── HTML parsing for VDO.Ninja chat ────────────────────────────────────

interface ParsedChatBody {
  /** Sender label extracted from the HTML, or null if not embedded. */
  label: string | null;
  /** Plain-text message body, with all HTML tags and entities stripped. */
  msg: string;
}

function stripHtmlTags(input: string): string {
  return input.replace(/<[^>]*>/g, "");
}

/**
 * Parses one VDO.Ninja chat `msg` field. Two shapes show up in the wild:
 *
 *   "<b><span class='chat_name'>Gnoc</span>:</b> hello"
 *     → { label: "Gnoc", msg: "hello" }
 *
 *   "hello"  (already plain)
 *     → { label: null, msg: "hello" }
 *
 * Strips every tag from the body via DOMParser + textContent — safer
 * than a regex strip (handles attributes with `>` chars, malformed tags,
 * HTML entities) and never feeds raw markup back into React.
 */
export function parseChatBody(raw: string): ParsedChatBody {
  if (typeof raw !== "string") return { label: null, msg: "" };
  // Fast path: no markup, return as-is.
  if (!raw.includes("<")) return { label: null, msg: raw };

  // DOMParser is the standard, XSS-safe way to convert HTML to text.
  // The parsed document is detached and never inserted into the live DOM.
  const doc = new DOMParser().parseFromString(raw, "text/html");
  const body = doc.body;

  // Drop script/style elements entirely so their body text doesn't leak
  // into the rendered chat. Detached DOMParser docs don't execute scripts,
  // but their `textContent` still includes the script source as text.
  body.querySelectorAll("script, style").forEach((el) => el.remove());

  // Look for VDO.Ninja's signature `.chat_name` span as the label.
  const nameEl = body.querySelector(".chat_name");
  let label: string | null = null;
  if (nameEl) {
    label = nameEl.textContent?.trim() || null;
    // Remove the "<b>NAME:</b>" prefix block so the body text is just
    // the message. Walk up to the bold/span wrapper so the trailing
    // ":" is also cleared.
    const wrapper = nameEl.closest("b") ?? nameEl;
    wrapper.remove();
  }

  // textContent gives us a tag-free, entity-decoded string. Trim a
  // leading ":" + whitespace VDO.Ninja injects between label and body.
  const text = (body.textContent ?? "").replace(/^\s*:?\s*/, "").trimEnd();
  return { label, msg: text };
}

/**
 * Sends a chat message via the VDO.Ninja iframe. Returns true if the
 * iframe is mounted and the message was posted; false otherwise so
 * callers can decide whether to surface an error.
 */
export function sendChat(
  iframeRef: RefObject<HTMLIFrameElement>,
  text: string,
): boolean {
  const win = iframeRef.current?.contentWindow;
  if (!win) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  win.postMessage({ sendChat: trimmed }, "*");
  return true;
}

/**
 * Subscribes to inbound chat events from the VDO.Ninja iframe. Returns
 * an unsubscribe function for use in useEffect cleanup.
 *
 * VDO.Ninja's iframe emits chat under a couple of shapes depending on
 * build (`incoming-chat` action, or a top-level `chat` field). We read
 * defensively and ignore everything that doesn't look like chat.
 */
export function onChat(
  iframeRef: RefObject<HTMLIFrameElement>,
  callback: (msg: Omit<ChatMessage, "id" | "source">) => void,
): () => void {
  const handler = (event: MessageEvent) => {
    const data = event.data as Record<string, unknown> | null | undefined;
    if (!data || typeof data !== "object") return;

    // Soft source check: if the iframe is present, verify the origin looks
    // like VDO.Ninja. We skip strict event.source === contentWindow because
    // VDO.Ninja navigates the iframe after load, invalidating the ref.
    const win = iframeRef.current?.contentWindow;
    if (
      win &&
      event.source !== win &&
      event.origin !== "https://vdo.ninja" &&
      event.origin !== "https://www.vdo.ninja"
    ) {
      return;
    }

    // Always log in DEV so we can see what VDO.Ninja actually sends.
    if (import.meta.env.DEV) {
      console.log("[vdoninjaChat] raw event.data:", JSON.stringify(data));
    }

    // Shape A: { action: 'incoming-chat', value: { msg, label, ts? } }
    if (data["action"] === "incoming-chat") {
      if (import.meta.env.DEV) {
        console.log("[vdoninjaChat] matched Shape A (incoming-chat)");
      }
      const value = data["value"] as Record<string, unknown> | undefined;
      // Defensive: VDO.Ninja has used msg, message, or text in different builds.
      const rawMsg =
        typeof value?.["msg"] === "string"
          ? (value["msg"] as string)
          : typeof value?.["message"] === "string"
            ? (value["message"] as string)
            : typeof value?.["text"] === "string"
              ? (value["text"] as string)
              : null;
      const sidecarLabel =
        typeof value?.["label"] === "string" ? (value["label"] as string) : "";
      if (rawMsg) {
        emit(rawMsg, sidecarLabel, callback);
      } else if (import.meta.env.DEV) {
        console.warn("[vdoninjaChat] incoming-chat with no msg:", value);
      }
      return;
    }

    // Shape B: top-level `chat` field on the message itself
    const chat = data["chat"];
    if (chat && typeof chat === "object") {
      if (import.meta.env.DEV) {
        console.log("[vdoninjaChat] matched Shape B (top-level chat)");
      }
      const c = chat as Record<string, unknown>;
      const rawMsg =
        typeof c["msg"] === "string"
          ? (c["msg"] as string)
          : typeof c["message"] === "string"
            ? (c["message"] as string)
            : typeof c["text"] === "string"
              ? (c["text"] as string)
              : null;
      const sidecarLabel =
        typeof c["label"] === "string" ? (c["label"] as string) : "";
      if (rawMsg) {
        emit(rawMsg, sidecarLabel, callback);
      } else if (import.meta.env.DEV) {
        console.warn("[vdoninjaChat] top-level chat with no msg:", c);
      }
    }

    // If neither shape matched and this looks like it could be chat-related,
    // log it so we can discover new VDO.Ninja formats.
    if (
      import.meta.env.DEV &&
      (typeof data["msg"] === "string" ||
        typeof data["message"] === "string" ||
        typeof data["text"] === "string" ||
        data["action"] === "chat")
    ) {
      console.warn("[vdoninjaChat] unrecognized chat-like shape:", data);
    }
  };
  window.addEventListener("message", handler);
  return () => window.removeEventListener("message", handler);
}

/**
 * Normalizes one inbound chat field into the wrapper's `{label, msg}`
 * shape. `rawMsg` may be a plain string OR VDO.Ninja's HTML fragment
 * with the sender baked in via `<span class='chat_name'>`. The sidecar
 * `label` field (when present) wins as a fallback when no chat_name
 * span was embedded — and `Guest` is the last-resort label so we never
 * render an empty bubble.
 *
 * Falls back to a regex strip for any tags DOMParser might have missed
 * (e.g. malformed HTML that survives as literal text).
 */
function emit(
  rawMsg: string,
  sidecarLabel: string,
  callback: (msg: Omit<ChatMessage, "id" | "source">) => void,
): void {
  const { label: parsedLabel, msg } = parseChatBody(rawMsg);
  if (import.meta.env.DEV) {
    console.log("[vdoninjaChat] emit — raw:", rawMsg.slice(0, 120), "parsed label:", parsedLabel, "parsed msg:", msg?.slice(0, 120));
  }
  if (!msg) return;

  // VDO.Ninja sends labels as HTML fragments (e.g. "<b><span class='chat_name'>Guest1</span>:</b>").
  // parseChatBody knows how to extract .chat_name and strip the wrapper.
  const { label: parsedSidecarLabel } = parseChatBody(sidecarLabel);
  const label = parsedLabel || parsedSidecarLabel || stripHtmlTags(sidecarLabel) || "Guest";
  if (import.meta.env.DEV) {
    console.log("[vdoninjaChat] emit — final:", { label, msg: msg.slice(0, 120) });
  }
  callback({ msg, label, ts: Date.now() });
}

/**
 * React hook that wires inbound chat reception with auto-cleanup.
 * The consuming component renders the iframe element + ref itself
 * (PlayRoute already owns `iframeRef` from {@link useVdoNinja}).
 */
export function useVdoNinjaChat(
  iframeRef: RefObject<HTMLIFrameElement>,
  onMessage: (msg: Omit<ChatMessage, "id" | "source">) => void,
): { send: (text: string) => boolean } {
  // Pin the latest callback in a ref so the listener doesn't churn on
  // every parent render of the component that owns it.
  const cbRef = useRef(onMessage);
  useEffect(() => {
    cbRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    return onChat(iframeRef, (msg) => cbRef.current(msg));
  }, [iframeRef]);

  return {
    send: useCallback((text: string) => sendChat(iframeRef, text), [iframeRef]),
  };
}
