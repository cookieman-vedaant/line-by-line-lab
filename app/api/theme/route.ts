import { NextResponse } from "next/server";
import { z } from "zod";
import { guardApi } from "@/lib/apiGuard";
import { MissingApiKeyError, RateLimitedError } from "@/lib/gemini";
import { ThemeGenerationError, generateTheme } from "@/services/themeAgent";

// One Gemini call; the global throttle in lib/gemini smooths load across users.
export const maxDuration = 30;

const requestSchema = z.object({ prompt: z.string().trim().min(1).max(120) });

export async function POST(req: Request) {
  const blocked = await guardApi(req, { name: "theme" });
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Describe a theme in a few words." }, { status: 400 });
  }

  try {
    const spec = await generateTheme(parsed.data.prompt);
    return NextResponse.json({ spec });
  } catch (err) {
    if (err instanceof RateLimitedError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    if (err instanceof ThemeGenerationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    if (err instanceof MissingApiKeyError) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    console.error("theme route failed", err);
    return NextResponse.json({ error: "Theme design failed. Try again." }, { status: 500 });
  }
}
