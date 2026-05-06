/**
 * The set of cards a guest can play against another guest in a topic.
 *
 * MVP ships with two cards (STFU and MIC DROP); the system is configured
 * generically so adding GOAT / FACTS / etc. later is just a new entry
 * here plus its visual treatment in the overlay.
 *
 * `usesPerTopic` is the per-guest budget that resets when the producer
 * fires a "Reset cards" event between topics.
 */

export type CardId = "stfu" | "micdrop";

export type CardColor = "red" | "amber";

export interface Card {
  /** Stable identifier used in event payloads — never re-use across cards. */
  id: CardId;
  /** Display name shown on the card face. */
  name: string;
  /** Shorter name used in center-screen card announce (falls back to name). */
  shortName?: string;
  /** Theme color the wrapper + overlay use to style this card. */
  color: CardColor;
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
    color: "red",
    usesPerTopic: 1,
    description: "Cut off the current speaker",
  },
  {
    id: "micdrop",
    name: "MIC DROP",
    color: "amber",
    usesPerTopic: 1,
    description: "Crown the current speaker",
  },
] as const;

/** Convenience lookup by id; falls back to undefined for unknown ids. */
export function getCard(id: string): Card | undefined {
  return CARDS.find((c) => c.id === id);
}
