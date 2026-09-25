import { createSharedCache } from "@/lib/sharedCache";

/**
 * What the Article Finder knew about a source it returned, kept so the Card
 * Cutter can use it when the cut request arrives without it.
 *
 * Two gaps make this necessary:
 *
 *  - The finder now often hands back a work's free PDF instead of its landing
 *    page, because the PDF is the copy a debater can actually read. A PDF
 *    carries no byline or date the extractor can trust, so without this the
 *    card would cite the file's hostname with "no date".
 *  - A cut doesn't always carry the finder's metadata: the Coach cuts from a
 *    bare URL, and the cut route's request schema drops the structured author
 *    list. Keyed by URL here, the facts reach the cutter either way.
 *
 * Only real database/page metadata is stored — never anything a model wrote.
 */
export interface SourceMeta {
  title?: string;
  /** Display byline, e.g. "Hoynes et al." */
  author?: string;
  /** The individual people, unmangled — see Article.authors. */
  authors?: string[];
  authorInstitutions?: string[];
  publication?: string;
  date?: string;
  /**
   * Other copies to try if this URL fails at cut time — the result's original
   * link and its other full-text locations. A host that served the finder's
   * check can still refuse a later download.
   */
  fallbackUrls?: string[];
}

const sourceMetaCache = createSharedCache<SourceMeta>({
  // Long enough to cover a prep session's search → cut → re-cut; small values,
  // so sharing them across instances costs little.
  ttlMs: 2 * 60 * 60 * 1000,
  namespace: "srcmeta",
  maxLocal: 300,
});

const keyFor = (url: string) => url.trim();

/**
 * Resolves once the value is stored. The search should wait for it: on a
 * serverless platform a write still in flight when the response is sent can be
 * frozen with the function, and the cut — a different function — never sees it.
 */
export function rememberSourceMeta(url: string, meta: SourceMeta): Promise<void> {
  return url ? sourceMetaCache.set(keyFor(url), meta) : Promise.resolve();
}

export async function recallSourceMeta(url: string | undefined): Promise<SourceMeta | null> {
  if (!url) return null;
  return (await sourceMetaCache.get(keyFor(url))) ?? null;
}
