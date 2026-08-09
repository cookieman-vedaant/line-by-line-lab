/**
 * The one place the password rule lives.
 *
 * This MUST stay >= Supabase's `password_min_length` (8 in this project's auth
 * config). When a form allows a shorter password than the server accepts, the
 * user gets rejected for a rule our own UI told them they'd satisfied — and
 * because that rejection arrives from Supabase it reads as "something is broken"
 * rather than "your password is too short".
 *
 * It is a shared constant rather than a per-form literal because that is exactly
 * how the two drifted: the sign-in form was raised to 8 when the server was, and
 * the reset-password form was left on 6, so every reset to a 6- or 7-character
 * password failed at the last step.
 */
export const MIN_PASSWORD = 8;

/** Human-readable hint used as the input placeholder on every password field. */
export const PASSWORD_HINT = `at least ${MIN_PASSWORD} characters`;

/**
 * Validate a new password. Returns an error message, or null when it's fine.
 * `confirm` is optional — pass it on forms that ask the user to type it twice.
 */
export function passwordProblem(password: string, confirm?: string): string | null {
  if (password.length < MIN_PASSWORD) {
    return `Choose a password of at least ${MIN_PASSWORD} characters.`;
  }
  if (confirm !== undefined && password !== confirm) {
    return "The two passwords don't match.";
  }
  return null;
}
