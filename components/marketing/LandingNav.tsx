import Link from "next/link";

/**
 * Sticky top navigation for the public pages (landing + docs).
 *
 * It exists because pricing was the twelfth section of a single long scroll,
 * behind six scroll-scrubbed showpieces — a debater who wanted to know what
 * this costs had to scroll past the entire argument to find out.
 *
 * Deliberately a Server Component with plain links: no scroll-spy, no active
 * state, no client JS. That keeps the landing page's static shell prerendering
 * and costs nothing on a page that already runs several scroll-driven effects.
 *
 * Hrefs are ROOT-RELATIVE (`/#pricing`, not `#pricing`) so the same bar works
 * from /docs, where those sections don't exist.
 */
const NAV_LINKS: readonly { href: string; label: string }[] = [
  { href: "/#tools", label: "Tools" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/docs", label: "Docs" },
];

export default function LandingNav() {
  return (
    // Opaque, not glassy: a backdrop-filter pinned over the scroll-scrubbed
    // sections repaints every frame, and blur reads wrong against this
    // theme's hard edges.
    <div className="divide-b sticky top-0 z-40 w-full bg-paper">
      <nav
        aria-label="Main"
        className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2 px-4 py-2.5 sm:px-5 sm:py-3"
      >
        <Link href="/" className="flex shrink-0 items-center gap-2 hover:text-accent">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rotate-45 bg-red" />
          <span className="label-mono text-[11px] font-bold sm:text-xs">
            {/* The full wordmark doesn't fit beside four controls on a phone. */}
            <span className="sm:hidden">LBL</span>
            <span className="hidden sm:inline">Line by Line Lab</span>
          </span>
        </Link>

        <div className="flex items-center gap-1.5 sm:gap-2">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="btn-press frame bg-paper-2 px-2.5 py-1.5 font-display text-[10px] font-bold uppercase tracking-wide text-ink hover:text-accent sm:px-4 sm:py-2 sm:text-xs"
            >
              {link.label}
            </Link>
          ))}
          {/*
            Points at /lab rather than the sign-up anchor so it stays correct in
            both auth states without making this bar request-scoped: signed in,
            it goes straight to the Lab; signed out, proxy.ts bounces it to
            sign-in carrying ?next=/lab, so the debater still lands where they
            were headed.
          */}
          <Link
            href="/lab"
            className="btn-press frame bg-accent px-2.5 py-1.5 font-display text-[10px] font-bold uppercase tracking-wide text-paper sm:px-4 sm:py-2 sm:text-xs"
          >
            <span className="sm:hidden">Lab</span>
            <span className="hidden sm:inline">Enter the Lab</span>
          </Link>
        </div>
      </nav>
    </div>
  );
}
