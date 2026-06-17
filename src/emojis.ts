/**
 * The fixed set of 10 reaction emojis available to every guest in the
 * /play wrapper. Order is the on-screen order (2 rows of 5, top-left to
 * bottom-right). Treated as content, not code: change the set here, do
 * not hard-code emojis in components.
 *
 * Reserved-but-shelved during brainstorm: 🥱 (yawn), 🧂 (salt). Add via
 * a follow-up PR if the show wants them later.
 */

export type Emoji = (typeof EMOJIS)[number];

/** The MVP reaction set, in render order. */
export const EMOJIS = [
  // row 1: 🤯 🔥 ❤️ 💯 👏 👍
  "\u{1F92F}", // 🤯
  "\u{1F525}", // 🔥
  "\u{2764}\u{FE0F}", // ❤️
  "\u{1F4AF}", // 💯
  "\u{1F44F}", // 👏
  "\u{1F44D}", // 👍
  // row 2: 😂 💀 👀 🤡 💩 👎
  "\u{1F602}", // 😂
  "\u{1F480}", // 💀
  "\u{1F440}", // 👀
  "\u{1F921}", // 🤡
  "\u{1F4A9}", // 💩
  "\u{1F44E}", // 👎
] as const;

/**
 * Curated emoji set surfaced in the in-wrapper chat composer's emoji
 * picker. Distinct from EMOJIS (which are the show's reaction floats):
 * these are conversational and never broadcast as overlay events.
 */
export const CHAT_EMOJIS = [
  "\u{1F600}", // 😀
  "\u{1F602}", // 😂
  "\u{1F62D}", // 😭
  "\u{1F60D}", // 😍
  "\u{1F914}", // 🤔
  "\u{1F44F}", // 👏
  "\u{1F64F}", // 🙏
  "\u{2764}\u{FE0F}", // ❤️
  "\u{1F525}", // 🔥
  "\u{1F389}", // 🎉
  "\u{2728}", // ✨
  "\u{1F60E}", // 😎
  "\u{1F923}", // 🤣
  "\u{1F440}", // 👀
  "\u{1F480}", // 💀
] as const;

/** Per-emoji brand colour + hover glow params. Single source of truth for
 *  both OverlayRoute (drop-shadow) and PlayRoute (hover glow). */
export const EMOJI_COLOURS: Record<string, { hex: string; core: number; spread: number }> = {
  "\u{1F92F}": { hex: "#00e5ff", core: 0.50, spread: 20 },   // 🤯
  "\u{1F525}": { hex: "#ffb800", core: 0.55, spread: 20 },   // 🔥
  "\u{2764}\u{FE0F}": { hex: "#ff66b3", core: 0.50, spread: 20 },   // ❤️
  "\u{1F4AF}": { hex: "#a3e600", core: 0.60, spread: 24 },   // 💯
  "\u{1F44F}": { hex: "#5c8aff", core: 0.50, spread: 20 },   // 👏
  "\u{1F44D}": { hex: "#00e676", core: 0.50, spread: 20 },   // 👍
  "\u{1F602}": { hex: "#b866ff", core: 0.50, spread: 20 },   // 😂
  "\u{1F480}": { hex: "#ff8c42", core: 0.50, spread: 20 },   // 💀
  "\u{1F440}": { hex: "#ff4444", core: 0.50, spread: 20 },   // 👀
  "\u{1F921}": { hex: "#ffd700", core: 0.70, spread: 26 },   // 🤡
  "\u{1F4A9}": { hex: "#66ffcc", core: 0.60, spread: 24 },   // 💩
  "\u{1F44E}": { hex: "#ff2a6d", core: 0.55, spread: 22 },   // 👎
};
