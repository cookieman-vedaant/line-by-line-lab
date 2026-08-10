"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Signs the user out and returns them to the sign-in page.
 *
 * Deliberately a FULL document navigation, not router.push. Several client
 * stores keep their data in module-level singletons that outlive a client-side
 * route change (lib/roundLog and lib/profileStore both do) — so signing out with
 * router.push left one account's rounds and debater profile sitting in memory,
 * and the NEXT account to sign in on the same browser saw them until something
 * forced a reload. A shared laptop is the normal case for a debate team, so that
 * is not a hypothetical.
 *
 * Reloading the document is the only thing that reliably clears every store at
 * once, including any added later that forgets to register a reset hook.
 */
export default function SignOutButton() {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    await createSupabaseBrowserClient().auth.signOut();
    window.location.assign("/");
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      className="label-mono frame btn-press bg-paper-2 px-3 py-1.5 text-[10px] font-bold text-ink hover:text-accent disabled:opacity-60"
    >
      {busy ? "…" : "Sign out"}
    </button>
  );
}
