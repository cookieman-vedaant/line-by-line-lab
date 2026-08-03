import type { Metadata } from "next";
import ConfirmEmail from "@/components/ConfirmEmail";

export const metadata: Metadata = {
  title: "Confirming your email — Line by Line Lab",
  // A confirmation URL carries a single-use credential. Keep it out of indexes.
  robots: { index: false, follow: false },
};

/**
 * Where a signup confirmation link lands. The work happens on the client because
 * one of the three shapes Supabase can send the credential in (`#access_token`)
 * lives in the URL fragment, which never reaches the server — see ConfirmEmail.
 * Excluded from the proxy matcher so nothing touches the auth cookies between the
 * click and the exchange.
 */
export default function ConfirmPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-5 py-20">
      <ConfirmEmail />
    </main>
  );
}
