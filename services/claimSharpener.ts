import { z } from "zod";
import { generateJson } from "@/lib/gemini";

/**
 * Sharpen a claim before it is searched.
 *
 * Debaters type the argument they have in their head, not the sentence a search
 * engine needs. "the economy is bad now" is a real request and a useless query:
 * it names a conclusion and no WARRANT, so the search comes back with a hundred
 * articles that each mean something different by "bad".
 *
 * The fix is not to guess which warrant they meant — that silently changes what
 * they asked for. It is to show them the choice: name what is missing, then
 * offer complete claims they can pick from, each committing to one mechanism.
 * The debater stays the author of their own claim; the tool just makes the
 * options visible.
 *
 * This never searches and never returns evidence. It rewrites one sentence.
 */

const sharpenSchema = z.object({
  /** Empty when the claim is already specific enough to search well. */
  missing: z.string().default(""),
  options: z
    .array(
      z.object({
        claim: z.string().min(1),
        /** What this version commits to that the original didn't. */
        angle: z.string().min(1),
      }),
    )
    .max(4)
    .default([]),
});

export type SharpenedClaim = z.infer<typeof sharpenSchema>;

const SHARPEN_SYSTEM = `You sharpen a debater's evidence request inside a Lincoln-Douglas prep tool, immediately BEFORE it is used to search academic databases and the open web. You do not search, and you never write evidence.

A good evidence claim names three things:
  1. the SUBJECT — what the evidence is about;
  2. the MECHANISM or WARRANT — the specific reason the claim is true, which is what makes two articles on the same topic different pieces of evidence;
  3. the DIRECTION — what it must prove (declining/rising, works/fails, unique now/not unique).

Debaters routinely supply 1 and 3 and leave out 2, because the mechanism is obvious to them and invisible to a search engine. "The economy is bad in the status quo" is a conclusion with no warrant: labor market softening, consumer credit stress, manufacturing contraction and inflation expectations are four different searches with four different literatures, and an article proving one does not prove another.

Return ONLY JSON: {"missing": "...", "options": [{"claim": "...", "angle": "..."}, ...]}

missing — one short sentence naming what the claim does not yet specify, addressed to the debater ("This doesn't say WHY the economy is weak, and that changes which articles come back."). If the claim already names a subject, a mechanism and a direction, return "" and an EMPTY options list. A specific claim must be left alone.

options — 3 or 4 complete replacement claims. Each one:
  - is a full sentence the debater could search as-is, not a topic or a question;
  - keeps the debater's SUBJECT and DIRECTION exactly. You are supplying the missing mechanism, not changing what they argue. Never flip uniqueness, never swap the actor, never soften the direction;
  - commits to ONE mechanism, different from the others, and names it in concrete terms an academic literature actually uses;
  - is plausibly TRUE and researchable. Do not offer a mechanism you believe the evidence does not support — sending a debater after evidence that does not exist wastes the round they were prepping for;
  - stays close to the debater's register. Do not inflate a modest claim into an existential one.

angle — 3 to 8 words naming the mechanism ("labor market softening", "consumer credit stress"). It is a label, not a sentence.

Order the options strongest-evidence-first: the mechanism with the deepest, most citable literature goes first.

If the claim is too vague to guess a subject at all ("economy", "help"), set missing to a request for the subject and return an empty options list — do not invent an argument for them.`;

/**
 * Ask for sharper versions of a claim. Returns empty options when the claim is
 * already good, which the UI reads as "nothing to suggest" rather than an error.
 */
export async function sharpenClaim(claim: string, evidenceType?: string): Promise<SharpenedClaim> {
  const prompt = [
    evidenceType ? `Evidence type the debater wants: ${evidenceType}` : "",
    `The debater's claim: ${claim.trim()}`,
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await generateJson({
    system: SHARPEN_SYSTEM,
    prompt,
    maxOutputTokens: 1024,
  });

  const parsed = sharpenSchema.safeParse(raw);
  // A malformed suggestion is not worth failing a search over — the debater can
  // always search what they typed.
  if (!parsed.success) return { missing: "", options: [] };

  // Drop any "suggestion" that is just the claim back again.
  const original = claim.trim().toLowerCase();
  const options = parsed.data.options.filter((o) => o.claim.trim().toLowerCase() !== original);
  return { missing: options.length > 0 ? parsed.data.missing : "", options };
}
