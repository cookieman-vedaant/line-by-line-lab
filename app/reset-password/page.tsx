import type { Metadata } from "next";
import ResetPasswordForm from "@/components/ResetPasswordForm";

export const metadata: Metadata = {
  title: "Reset your password — Line by Line Lab",
};

/**
 * Where a password-reset email link lands (directly, or after /auth/callback
 * establishes the recovery session). The form detects the recovery session on
 * the client and either lets the user set a new password or explains that the
 * link is invalid/expired. Not gated by middleware; the actual password change
 * (updateUser) only works with a real recovery session.
 */
export default function ResetPasswordPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-5 py-20">
      <ResetPasswordForm />
    </main>
  );
}
