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
  "\u{1F525}", // 🔥
  "\u{1F480}", // 💀
  "\u{1F602}", // 😂
  "\u{1F92F}", // 🤯
  "\u{1F440}", // 👀
  "\u{1F4AF}", // 💯
  "\u{1F921}", // 🤡
  "\u{1F44D}", // 👍
  "\u{1F44E}", // 👎
  "\u{1F4A9}", // 💩
  "\u{1F44F}", // 👏
  "\u{2764}\u{FE0F}", // ❤️
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
