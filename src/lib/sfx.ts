/**
 * Shared SFX system for card sounds.
 *
 * All three surfaces (overlay, guest wrapper, producer panel) need to play
 * the same sounds on cardPlay events. The overlay needs them for OBS
 * recording; the wrapper needs them for guests/host/editor; the producer
 * needs them so Lemz hears what aired.
 *
 * Audio objects are preloaded on first call and cached so repeated plays
 * don't re-download. Each playback clones the cached object so overlapping
 * sounds (e.g. rapid back-to-back cards) don't cut each other off.
 *
 * IMPORTANT for OBS: the overlay browser source must have "Audio Output"
 * set to "Render audio to desktop" in OBS source properties for the SFX
 * to reach the recording/stream mix.
 */

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
      audio.volume = 1.0;
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
    audio.volume = 1.0;
    audio.preload = "auto";
    sfxCache.set(src, audio);
  }
  const clone = audio.cloneNode() as HTMLAudioElement;
  clone.volume = 1.0;
  return clone.play().catch(() => {/* autoplay policy — silent fail */});
}

/** SFX file paths (for direct reference if needed). */
export const CARD_SFX = { stfu: SFX_STFU, micdrop: SFX_MICDROP } as const;