/**
 * Bold 5x7 pixel font for the round 5 card styles (set=r5), drawn as SVG
 * squares so it stays crisp at any size and needs no font file.
 *
 * Only the characters the card texts use are defined: SHUT THE !@#$ UP!!,
 * WRAP IT UP!, MIC DROP, SILENCED. Unknown characters are skipped.
 * "Bold" doubles every stroke sideways (what makes it read at card size);
 * M, W, N, #, @ and $ have hand-drawn bold forms because doubling would
 * close their gaps. Ported from explorations/round5/cards/v6.js.
 */

const GLYPHS: Record<string, string[]> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  "!": ["#", "#", "#", "#", "#", ".", "#"],
  "@": [".###.", "#...#", "#.###", "#.#.#", "#.###", "#....", ".###."],
  "#": [".#.#.", ".#.#.", "#####", ".#.#.", "#####", ".#.#.", ".#.#."],
  $: ["..#..", ".####", "#.#..", ".###.", "..#.#", "####.", "..#.."],
};

const BOLD: Record<string, string[]> = {
  M: ["##...##", "###.###", "##.#.##", "##.#.##", "##...##", "##...##", "##...##"],
  W: ["##...##", "##...##", "##...##", "##.#.##", "##.#.##", "#######", ".##.##."],
  N: ["##...##", "###..##", "####.##", "##.####", "##..###", "##...##", "##...##"],
  "#": [".##.##.", ".##.##.", "#######", ".##.##.", "#######", ".##.##.", ".##.##."],
  "@": [".#####.", "##...##", "##.####", "##.##.#", "##.####", "##.....", ".#####."],
  $: ["...#...", ".######", "##.#...", ".#####.", "...#.##", "######.", "...#..."],
};

export interface PixelTextOptions {
  /** Line breaks with "\n". */
  text: string;
  /** Letter fill colour. */
  fill?: string;
  /** One-pixel outline around the letters. */
  outline?: string | null;
  /** Hard one-pixel drop shadow (ignored when `extrude` is set). */
  shadow?: string | null;
  /** Stepped 3D extrusion: one layer per colour, front to back, each one pixel further down-right. */
  extrude?: readonly string[] | null;
  /** Empty pixels between letters. */
  track?: number;
  /** Empty pixels between lines. */
  gap?: number;
}

export interface PixelLayout {
  /** Size in font pixels (multiply by the pixel size to get CSS px). */
  w: number;
  h: number;
  /** Path layers, back to front. */
  layers: { d: string; fill: string }[];
}

const cache = new Map<string, PixelLayout>();

/** Lays out pixel text as SVG path layers in font-pixel units. Cached per options. */
export function layoutPixelText(o: PixelTextOptions): PixelLayout {
  const key = JSON.stringify(o);
  const hit = cache.get(key);
  if (hit) return hit;
  const { text, fill = "#fff", outline = null, shadow = null, extrude = null, track = 1, gap = 3 } = o;

  const lines = text.split("\n").map((line) => {
    const on: [number, number][] = [];
    let x = 0;
    for (const ch of line) {
      if (ch === " ") { x += 2 + track; continue; }
      const own = BOLD[ch];
      const g = own ?? GLYPHS[ch];
      if (!g) continue;
      const dbl = !own;
      const w = g[0]!.length + (dbl ? 1 : 0);
      g.forEach((row, y) => {
        for (let i = 0; i < row.length; i++) {
          if (row[i] !== "#") continue;
          on.push([x + i, y]);
          if (dbl) on.push([x + i + 1, y]);
        }
      });
      x += w + track;
    }
    return { on, w: Math.max(0, x - track) };
  });

  const pad = (outline ? 1 : 0) + Math.max(shadow ? 1 : 0, extrude ? extrude.length : 0);
  const W = Math.max(...lines.map((l) => l.w)) + pad * 2;
  const H = lines.length * 7 + (lines.length - 1) * gap + pad * 2;
  const pts: [number, number][] = [];
  lines.forEach((l, li) => {
    const ox = pad + Math.round((W - pad * 2 - l.w) / 2);
    const oy = pad + li * (7 + gap);
    for (const [x, y] of l.on) pts.push([ox + x, oy + y]);
  });
  const path = (dx: number, dy: number, grow: number) => {
    const seen = new Set<string>();
    let d = "";
    for (const [x, y] of pts) {
      for (let a = -grow; a <= grow; a++) {
        for (let b = -grow; b <= grow; b++) {
          const px = x + a + dx, py = y + b + dy, k = `${px},${py}`;
          if (seen.has(k)) continue;
          seen.add(k);
          d += `M${px} ${py}h1v1h-1z`;
        }
      }
    }
    return d;
  };

  const layers: { d: string; fill: string }[] = [];
  const grow = outline ? 1 : 0;
  if (extrude) for (let i = extrude.length - 1; i >= 0; i--) layers.push({ d: path(i + 1, i + 1, grow), fill: extrude[i]! });
  else if (shadow) layers.push({ d: path(1, 1, grow), fill: shadow });
  if (outline) layers.push({ d: path(0, 0, 1), fill: outline });
  layers.push({ d: path(0, 0, 0), fill });
  const out = { w: W, h: H, layers };
  cache.set(key, out);
  return out;
}
