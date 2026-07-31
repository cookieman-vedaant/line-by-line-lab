"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/** Signs the user out and returns them to the sign-in page. */
export default function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    await createSupabaseBrowserClient().auth.signOut();
    router.push("/");
    router.refresh();
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
