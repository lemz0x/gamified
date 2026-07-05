/**
 * Colon-triggered emoji autocomplete for the chat composer.
 *
 * When the user types ":" followed by word characters, we match against
 * this alias map. On exact match + non-word character (space, punctuation,
 * or Enter), the ":word" token is auto-replaced with the emoji.
 *
 * Multiple aliases can map to the same emoji (e.g. :heart and :love -> ❤️).
 */

export interface EmojiAliasEntry {
  emoji: string;
  aliases: string[];
}

export const EMOJI_ALIASES: readonly EmojiAliasEntry[] = [
  { emoji: "\u{1F92F}", aliases: ["mindblown", "shock", "explode"] },         // 🤯
  { emoji: "\u{1F525}", aliases: ["fire", "lit", "hot"] },                    // 🔥
  { emoji: "\u{2764}\u{FE0F}", aliases: ["heart", "love", "redheart"] },      // ❤️
  { emoji: "\u{1F4AF}", aliases: ["100", "hundred"] },                        // 💯
  { emoji: "\u{1F44F}", aliases: ["clap", "applause"] },                      // 👏
  { emoji: "\u{1F44D}", aliases: ["thumbsup", "up", "yes"] },                 // 👍
  { emoji: "\u{1F602}", aliases: ["laugh", "cry", "lol", "lmao"] },           // 😂
  { emoji: "\u{1F480}", aliases: ["skull", "dead", "rip"] },                  // 💀
  { emoji: "\u{1F440}", aliases: ["eyes", "look", "see"] },                   // 👀
  { emoji: "\u{1F921}", aliases: ["clown", "fool"] },                         // 🤡
  { emoji: "\u{1F4A9}", aliases: ["poop", "shit", "crap"] },                  // 💩
  { emoji: "\u{1F44E}", aliases: ["thumbsdown", "down", "no"] },              // 👎
  // Chat-only emojis (not in reaction set)
  { emoji: "\u{1F642}", aliases: ["smile"] },               // 🙂
  { emoji: "\u{1F603}", aliases: ["grin", "happy"] },                        // 😃
  { emoji: "\u{1F923}", aliases: ["rofl", "lmao"] },                         // 🤣
  { emoji: "\u{1F605}", aliases: ["sweat", "nervous"] },                     // 😅
  { emoji: "\u{1F62D}", aliases: ["sob", "cry"] },                           // 😭
  { emoji: "\u{1F622}", aliases: ["sad", "cry"] },                           // 😢
  { emoji: "\u{1F973}", aliases: ["party", "celebrate"] },                   // 🥳
  { emoji: "\u{1F60D}", aliases: ["love", "hearteyes"] },                     // 😍
  { emoji: "\u{1F914}", aliases: ["think", "hmm"] },                         // 🤔
  { emoji: "\u{1F621}", aliases: ["angry", "mad"] },                         // 😡
  { emoji: "\u{1F634}", aliases: ["sleep", "tired"] },                       // 😴
  { emoji: "\u{1F937}", aliases: ["shrug", "idk"] },                        // 🤷 (gender-neutral person shrugging)
  { emoji: "\u{1F64F}", aliases: ["pray", "thanks"] },                      // 🙏
  { emoji: "\u{270A}", aliases: ["fist", "power"] },                         // ✊
];

/** Flatten to a map for O(1) exact-match lookup: "fire" -> "🔥" */
const ALIAS_MAP: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const entry of EMOJI_ALIASES) {
    for (const alias of entry.aliases) {
      m.set(alias, entry.emoji);
    }
  }
  return m;
})();

export interface ColonMatch {
  /** The colon token including the colon, e.g. ":fir" */
  token: string;
  /** The word part without the colon, e.g. "fir" */
  word: string;
  /** Start index of the token in the original string */
  start: number;
  /** End index (exclusive) of the token in the original string */
  end: number;
  /** Matching emoji if exact match found */
  exactEmoji: string | null;
  /** Partial matches for dropdown (max 6), each is { alias, emoji } */
  suggestions: { alias: string; emoji: string }[];
}

/**
 * Find a colon token at or before the cursor position.
 * Returns null if no active colon token is found.
 */
export function findColonToken(text: string, cursorPos: number): ColonMatch | null {
  // Search backwards from cursor for a ":" that starts a token.
  // The token is ":" followed by word characters [a-zA-Z0-9].
  let colonIdx = -1;
  for (let i = cursorPos - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === ":") {
      colonIdx = i;
      break;
    }
    // If we hit a non-word character before finding ":", no token.
    if (!/[a-zA-Z0-9]/.test(ch)) return null;
  }
  if (colonIdx === -1) return null;

  const wordStart = colonIdx + 1;
  const word = text.slice(wordStart, cursorPos);

  // Empty word after colon — still show all suggestions
  const token = text.slice(colonIdx, cursorPos);

  const exactEmoji = ALIAS_MAP.get(word.toLowerCase()) ?? null;

  // Build suggestions: partial match on word prefix
  let suggestions: { alias: string; emoji: string }[] = [];
  if (word.length > 0) {
    const lower = word.toLowerCase();
    for (const entry of EMOJI_ALIASES) {
      for (const alias of entry.aliases) {
        if (alias.startsWith(lower)) {
          suggestions.push({ alias, emoji: entry.emoji });
          if (suggestions.length >= 6) break;
        }
      }
      if (suggestions.length >= 6) break;
    }
  } else {
    // No word typed yet — show first entry from each emoji
    for (const entry of EMOJI_ALIASES) {
      suggestions.push({ alias: entry.aliases[0], emoji: entry.emoji });
      if (suggestions.length >= 6) break;
    }
  }

  return {
    token,
    word,
    start: colonIdx,
    end: cursorPos,
    exactEmoji,
    suggestions,
  };
}

/**
 * Replace a colon token with its emoji if it's an exact match.
 * Called when a non-word character is typed after the token (space, punctuation)
 * or on submit. Returns the new text and new cursor position, or null if no
 * replacement was made.
 */
export function tryAutoInsert(
  text: string,
  cursorPos: number,
): { text: string; cursorPos: number } | null {
  // Look backwards from the character just typed for a colon token.
  // cursorPos is AFTER the non-word character was already added.
  // We search from cursorPos - 1 (the non-word char) backwards.
  const beforeChar = text.slice(0, cursorPos - 1);
  // Find the last colon token in beforeChar
  const match = findColonToken(beforeChar, beforeChar.length);
  if (!match || !match.exactEmoji) return null;

  // Replace ":word" with the emoji, keep the trailing character
  const before = text.slice(0, match.start);
  // match.end is the cursor position in beforeChar, which is
  // beforeChar.length. The non-word char is at cursorPos - 1.
  // We need: before + emoji + nonWordChar + rest
  const nonWordChar = text[cursorPos - 1] ?? "";
  const newText = before + match.exactEmoji + nonWordChar + text.slice(cursorPos);
  const newCursor = match.start + match.exactEmoji.length + 1;
  return { text: newText, cursorPos: newCursor };
}

/**
 * On submit (Enter key), sweep the entire text for any ":alias" tokens
 * and replace them. Handles the case where user typed ":fire" and hit
 * Enter without adding a trailing space.
 */
export function replaceAllColonTokens(text: string): string {
  return text.replace(/:([a-zA-Z0-9]+)/g, (match, alias) => {
    const emoji = ALIAS_MAP.get(alias.toLowerCase());
    return emoji ?? match;
  });
}

/** Get the primary shorthand for an emoji (for hover tooltips). */
const EMOJI_TO_SHORTHAND: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const entry of EMOJI_ALIASES) {
    m.set(entry.emoji, entry.aliases[0]);
  }
  return m;
})();

export function emojiShorthand(emoji: string): string | undefined {
  return EMOJI_TO_SHORTHAND.get(emoji);
}
