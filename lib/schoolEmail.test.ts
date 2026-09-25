import { describe, expect, it } from "vitest";
import { looksLikeSchoolEmail } from "@/lib/schoolEmail";

/*
 * Measured 2026-09-25: every account that signed up but never confirmed was a
 * Frisco ISD address (k12.friscoisd.org on Google Workspace for Education,
 * friscoisd.org on Microsoft 365). Supabase sent each confirmation email; the
 * district's filter never delivered it. Gmail addresses confirmed in minutes.
 */
describe("looksLikeSchoolEmail", () => {
  it("recognizes the district addresses that never received the email", () => {
    expect(looksLikeSchoolEmail("student@k12.friscoisd.org")).toBe(true);
    expect(looksLikeSchoolEmail("teacher@friscoisd.org")).toBe(true);
  });

  it("recognizes common K-12 and school domains", () => {
    for (const email of [
      "a@dallasisd.org",
      "a@cfisd.net",
      "a@lausd.net",
      "a@k12.sd.us",
      "a@dpsk12.org",
      "a@students.district.org",
      "a@jeffcopublicschools.org",
      "a@fcps.edu",
      "a@mail.strakejesuit.edu",
    ]) {
      expect(looksLikeSchoolEmail(email), email).toBe(true);
    }
  });

  it("leaves personal addresses alone", () => {
    for (const email of ["a@gmail.com", "a@outlook.com", "a@icloud.com", "a@yahoo.com", "a@proton.me", ""]) {
      expect(looksLikeSchoolEmail(email), email).toBe(false);
    }
  });

  it("ignores case and surrounding spaces", () => {
    expect(looksLikeSchoolEmail("  Student@K12.FriscoISD.org ")).toBe(true);
  });
});
