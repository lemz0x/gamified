/**
 * The set of cards a guest can play against another guest in a topic.
 *
 * MVP ships with three cards (STFU, WRAP IT UP, MIC DROP); the system is
 * configured generically so adding more later is just a new entry here
 * plus its visual treatment in the overlay.
 *
 * `usesPerTopic` is the per-guest budget that resets when the producer
 * fires a "Reset cards" event between topics.
 */

export type CardId = "stfu" | "micdrop" | "wrapitup";

export interface Card {
  /** Stable identifier used in event payloads — never re-use across cards. */
  id: CardId;
  /** Display name shown on the card face. */
  name: string;
  /** Shorter name used in center-screen card announce (falls back to name). */
  shortName?: string;
  /** Emoji icon for the card. */
  icon: string;
  /** Subtitle below the slug on the card face. */
  subtitle: string;
  /** How many times each guest can play this card before the producer resets. */
  usesPerTopic: number;
  /** Short, human-readable purpose; surfaces in tooltips / target picker. */
  description: string;
}

/** All cards available in the MVP, in render order. */
export const CARDS: readonly Card[] = [
  {
    id: "stfu",
    name: "SHUT THE !@#$ UP",
    shortName: "STFU",
    icon: "\u{1F910}",
    subtitle: "Shut the !@#$ Up",
    usesPerTopic: 1,
    description: "Cut off the current speaker",
  },
  {
    id: "wrapitup",
    name: "WRAP IT UP!",
    shortName: "WRAP IT UP",
    icon: "\u{23F0}",
    subtitle: "Time's Up",
    usesPerTopic: 3,
    description: "Nudge the speaker to finish",
  },
  {
    id: "micdrop",
    name: "MIC DROP",
    shortName: "MIC DROP",
    icon: "\u{1F3A4}",
    subtitle: "Crown the Speaker",
    usesPerTopic: 3,
    description: "Crown the current speaker",
  },
] as const;

/** Convenience lookup by id; falls back to undefined for unknown ids. */
export function getCard(id: string): Card | undefined {
  return CARDS.find((c) => c.id === id);
}
