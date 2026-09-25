/**
 * Does this address belong to a school? School mail filters are why signups
 * never got their confirmation email: measured 2026-09-25, every account that
 * signed up but never confirmed was a Frisco ISD address — students on Google
 * Workspace for Education, staff on Microsoft 365 — while Gmail addresses
 * confirmed within minutes. Supabase sent every one; the district never
 * delivered them. Nothing on our side can change a district's filter, so the
 * signup form warns before the address is used.
 *
 * Deliberately generous: a false positive costs one line of advice.
 */
const SCHOOL_DOMAIN = [
  /\.edu(\.[a-z]{2})?$/, // US schools and colleges; .edu.au etc.
  /k12/, // k12.ca.us, dpsk12.org, k12.friscoisd.org
  /(^|\.)(students?|stu|pupils?|learners?)\./, // student mail subdomains
  /(^|\.)[a-z0-9-]*(isd|usd|schools?)\.[a-z]+$/, // friscoisd.org, lausd.net, …publicschools.org
];

export function looksLikeSchoolEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  return domain.length > 0 && SCHOOL_DOMAIN.some((re) => re.test(domain));
}

/** What to tell someone signing up with one. */
export const SCHOOL_EMAIL_HINT =
  "School email accounts often block outside emails like our confirmation link. A personal email (like Gmail) works best.";
