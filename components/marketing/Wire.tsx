import { connection } from "next/server";
import { getIndexedCardCount, getWireTags } from "@/services/wikiStats";

/**
 * Holds the Wire's band and stamp while the sampled tags stream in, so the page
 * shell never blocks on the ~one-time sample query and the layout never shifts.
 */
export function WireSkeleton() {
  return (
    <aside className="wire" aria-hidden>
      <div className="wire-stamp">
        <span className="wire-diamond" />
        <span>The Wire</span>
      </div>
      <div className="wire-viewport">
        <span className="wire-loading">pulling the latest cards…</span>
      </div>
    </aside>
  );
}

/**
 * The Wire — a press-service ticker of REAL disclosed card tags, pulled from the
 * wiki index. It makes the "X,000+ pre-cut cards" claim tangible and doubles as
 * live proof of the Wiki tool: these are actual arguments teams disclosed, not
 * copy. Pure CSS marquee (no client JS); pauses on hover/focus; static and
 * honest with reduced motion. Both reads are "use cache", so it prerenders into
 * the static shell exactly like StatBar — no per-request work.
 *
 * Hidden entirely when the index is too sparse to be worth showing, so it never
 * ships a thin or empty ticker.
 */
export async function Wire() {
  // Render dynamically, not in the static prerender: the shared cache reads
  // Date.now() (for TTL), which a prerender forbids. The page already wraps this
  // in <Suspense fallback={<WireSkeleton/>}>, so the shell paints instantly and
  // the Wire streams in — this just makes that official.
  await connection();

  const [items, count] = await Promise.all([getWireTags(), getIndexedCardCount()]);
  if (items.length < 8) return null;

  // Doubled so a -50% translate loops seamlessly with no visible seam.
  const run = [...items, ...items];

  return (
    <aside
      className="wire"
      aria-label={`A sample of real disclosed cards${
        count ? ` from ${count.toLocaleString()}+ in the index` : ""
      }, searchable in the Wiki tool`}
    >
      <div className="wire-stamp">
        <span aria-hidden className="wire-diamond" />
        <span>The Wire</span>
        {count != null && <span className="wire-count">{count.toLocaleString()}+ cards</span>}
      </div>
      <div className="wire-viewport">
        <div className="wire-track" aria-hidden>
          {run.map((it, i) => (
            <span key={i} className="wire-item">
              <span className="wire-div">{it.division}</span>
              <span className="wire-tag">{it.tag}</span>
              <span className="wire-sep" aria-hidden />
            </span>
          ))}
        </div>
      </div>
    </aside>
  );
}
