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
 * Volume is per-card: STFU is quieter (0.4) because the alarm sound is
 * piercing; MIC DROP is at 0.5. Both loud enough to punch through stream
 * audio but not overwhelming.
 */

const SFX_VOLUME: Record<string, number> = {
  stfu: 0.4,    // 20% quieter than micdrop — alarm is piercing at higher volumes
  micdrop: 0.5,
};

const SFX_STFU = "/sfx/stfu.mp3";
const SFX_MICDROP = "/sfx/micdrop.mp3";

/** Map from cardId to its source file. */
const SFX_SRC: Record<string, string> = { stfu: SFX_STFU, micdrop: SFX_MICDROP };

const sfxCache = new Map<string, HTMLAudioElement>();

/**
 * Preload both card SFX into the browser cache so the first play
 * has zero network delay. Call on mount from every surface that
 * will play card sounds.
 */
export function preloadCardSfx(): void {
  for (const [cardId, src] of Object.entries(SFX_SRC)) {
    if (!sfxCache.has(src)) {
      const audio = new Audio(src);
      audio.volume = SFX_VOLUME[cardId] ?? 0.5;
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
  const src = SFX_SRC[cardId] ?? SFX_MICDROP;
  const vol = SFX_VOLUME[cardId] ?? 0.5;
  let audio = sfxCache.get(src);
  if (!audio) {
    audio = new Audio(src);
    audio.volume = vol;
    audio.preload = "auto";
    sfxCache.set(src, audio);
  }
  const clone = audio.cloneNode() as HTMLAudioElement;
  clone.volume = vol;
  return clone.play().catch(() => {/* autoplay policy — silent fail */});
}

/** SFX file paths (for direct reference if needed). */
export const CARD_SFX = { stfu: SFX_STFU, micdrop: SFX_MICDROP } as const;