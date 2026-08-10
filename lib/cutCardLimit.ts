/**
 * How many cards one account keeps in its library.
 *
 * The number is a STORAGE budget, not a usability one, and it was chosen from
 * measurement rather than feel: a real cut-card body averages ~20KB (an Entire
 * Article cut is larger), so 500 cards is ~10MB per account. Against the ≤100
 * user target that is a ~1GB worst case on a database that has already hit a
 * capacity ceiling once — see the wiki backfill. Typical use lands far below it:
 * a heavy season of personal cutting is a few hundred cards.
 *
 * Past the cap the OLDEST card is evicted, not the newest refused. The library's
 * whole promise is that you never think about saving, and a full library that
 * silently stops recording would break that at the worst possible moment — the
 * card you just cut is the one you are about to read. A rolling window keeps
 * that promise; the panel says plainly that it is a window.
 *
 * MUST match the `cap` constant in `enforce_cut_cards_cap()`, which is where the
 * rule is actually enforced (a trigger, so it holds even for a client writing
 * straight to PostgREST with its own token). This constant only drives what the
 * interface SAYS the limit is. To change the real limit, re-run that function
 * with a new value and update this number in the same commit — a mismatch means
 * the app promises a ceiling the database does not honour.
 */
export const CUT_CARDS_MAX_PER_USER = 500;

/** Show the "running out of room" warning from this many cards onward. */
export const CUT_CARDS_WARN_AT = Math.floor(CUT_CARDS_MAX_PER_USER * 0.9);
