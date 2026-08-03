/**
 * The Cut — the page tears.
 *
 * A full-bleed break where the sheet the whole site is printed on comes apart,
 * showing a second sheet through the gap with its own printing on it. It is
 * deliberately not a graphic inside a section: every other landing page is a
 * stack of rectangles, and this one isn't.
 *
 * The torn edge is a single clip-path polygon built here at module scope from a
 * fixed seed — so it is byte-identical on every render, prerenders into the
 * static shell, and costs nothing at runtime. Motion is a scroll-scrubbed clip
 * wipe (see `.tear-*` in globals.css); there is no canvas, no scroll listener,
 * and nothing per-frame in JavaScript.
 */

/** Band geometry, in px down from the top of the band. */
const TOP_Y = 34;
const BOTTOM_Y = 78;
/**
 * Points per edge. This is the number that decides whether the edge reads as torn
 * paper or as a wavy line: at 46 the segments are ~30px wide on a desktop viewport,
 * which is a shallow enough angle to look smooth. 88 puts them under 16px.
 */
const POINTS = 88;

/** Deterministic PRNG, so the tear is the same shape on every build and reload. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Point {
  x: number;
  y: number;
}

/**
 * One edge of the tear. Three components, because a single noise band reads as a
 * zigzag rather than as paper: a slow random-walk wander for the overall line, a
 * fine jitter for the fibre, and an occasional larger pull where a fibre lets go.
 */
function tornEdge(rng: () => number, baseY: number): Point[] {
  const pts: Point[] = [];
  let wander = 0;
  for (let i = 0; i < POINTS; i += 1) {
    wander += (rng() - 0.5) * 2.6;
    wander = Math.max(-5.5, Math.min(5.5, wander));
    const pull = rng() < 0.15 ? (rng() - 0.5) * 12 : 0;
    const fibre = (rng() - 0.5) * 4.2;
    pts.push({ x: (i / (POINTS - 1)) * 100, y: baseY + wander + fibre + pull });
  }
  return pts;
}

const rng = mulberry32(20260803);
const TOP = tornEdge(rng, TOP_Y);
const BOTTOM = tornEdge(rng, BOTTOM_Y);

/** Left-to-right along the top edge, then right-to-left back along the bottom. */
const GAP_POLYGON = `polygon(${[...TOP, ...BOTTOM.slice().reverse()]
  .map((p) => `${p.x.toFixed(2)}% ${p.y.toFixed(1)}px`)
  .join(", ")})`;

/** Repeated far enough to cover an ultrawide viewport; the band clips the rest. */
const PRINT = Array.from({ length: 16 }, () => "LINE BY LINE LAB").join("  ·  ");

export default function Tear() {
  return (
    <div className="tear" aria-hidden>
      <div className="tear-run">
        <div className="tear-stock" style={{ clipPath: GAP_POLYGON }}>
          <p className="tear-print">{PRINT}</p>
        </div>
      </div>
    </div>
  );
}
