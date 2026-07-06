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
 * Volume is per-card: all cards at 0.4. The source files themselves are
 * pre-attenuated (volume=0.5 applied at encode time, peaks around -9 dB)
 * so the HTML5 volume slider scales on top of an already-quiet source.
 *
 * Cache-busting: SFX_SRC includes a version param so stale browser/CDN
 * caches never serve old files after an audio update. Bump SFX_VERSION
 * whenever any MP3 file is replaced.
 */

/** Bump this whenever any SFX file is replaced on disk. */
const SFX_VERSION = "v7";

const SFX_VOLUME: Record<string, number> = {
  stfu: 0.4,
  micdrop: 0.4,
  wrapitup: 0.4,
};

/** Map from cardId to its source file. Query param busts browser cache. */
const SFX_SRC: Record<string, string> = {
  stfu: `/sfx/stfu.mp3?${SFX_VERSION}`,
  micdrop: `/sfx/micdrop.mp3?${SFX_VERSION}`,
  wrapitup: `/sfx/wrapitup.mp3?${SFX_VERSION}`,
};

const sfxCache = new Map<string, HTMLAudioElement>();

/**
 * Preload all card SFX into the browser cache so the first play
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
 * The clone is auto-cleaned from the DOM after playback ends.
 * Returns a Promise that resolves when playback starts (or rejects silently
 * if blocked by autoplay policy).
 */
export function playCardSfx(cardId: string): Promise<void> {
  const src = SFX_SRC[cardId] ?? SFX_SRC["micdrop"];
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
  if (import.meta.env.DEV) {
    console.log(`[SFX] playing ${cardId} at volume ${vol} (src=${src})`);
  }
  // Clean up the clone after playback or error so orphaned Audio nodes don't pile up.
  const cleanup = () => {
    clone.pause();
    clone.removeAttribute("src");
    clone.load();
  };
  clone.addEventListener("ended", cleanup, { once: true });
  clone.addEventListener("error", cleanup, { once: true });
  return clone.play().catch(() => {/* autoplay policy — silent fail */});
}