/**
 * Shared SFX system for card sounds.
 *
 * All three surfaces (overlay, guest wrapper, producer panel) play the
 * same sounds on cardPlay events. The overlay's browser source captures
 * SFX for OBS recording; the wrapper plays for guests/host/editor;
 * the producer panel so Lemz hears what aired.
 *
 * Audio objects are preloaded on first call and cached so repeated plays
 * don't re-download. Each playback clones the cached object so overlapping
 * sounds (e.g. rapid back-to-back cards) don't cut each other off.
 *
 * Volume is set to 0.5 (50%) — loud enough to punch through stream audio
 * but not overwhelming.
 */

const SFX_VOLUME = 0.5;

const SFX_STFU = "/sfx/stfu.mp3";
const SFX_MICDROP = "/sfx/micdrop.mp3";

const sfxCache = new Map<string, HTMLAudioElement>();

/**
 * Preload both card SFX into the browser cache so the first play
 * has zero network delay. Call on mount from every surface that
 * will play card sounds.
 */
export function preloadCardSfx(): void {
  for (const src of [SFX_STFU, SFX_MICDROP]) {
    if (!sfxCache.has(src)) {
      const audio = new Audio(src);
      audio.volume = SFX_VOLUME;
      audio.preload = "auto";
      sfxCache.set(src, audio);
    }
  }
}

/**
 * Play a card sound effect. Uses a cached Audio object for zero-download
 * playback; clones so overlapping plays don't interrupt each other.
 * Returns a Promise that resolves when playback starts (or rejects silently
 * if blocked by autoplay policy).
 */
export function playCardSfx(cardId: string): Promise<void> {
  const src = cardId === "stfu" ? SFX_STFU : SFX_MICDROP;
  let audio = sfxCache.get(src);
  if (!audio) {
    audio = new Audio(src);
    audio.volume = SFX_VOLUME;
    audio.preload = "auto";
    sfxCache.set(src, audio);
  }
  const clone = audio.cloneNode() as HTMLAudioElement;
  clone.volume = SFX_VOLUME;
  return clone.play().catch(() => {/* autoplay policy — silent fail */});
}

/** SFX file paths (for direct reference if needed). */
export const CARD_SFX = { stfu: SFX_STFU, micdrop: SFX_MICDROP } as const;