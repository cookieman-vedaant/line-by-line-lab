import { describe, expect, it, vi } from "vitest";

const generateTheme = vi.fn();
vi.mock("@/services/themeAgent", () => ({
  generateTheme: (...a: unknown[]) => generateTheme(...a),
  ThemeGenerationError: class ThemeGenerationError extends Error {},
}));

import { POST } from "@/app/api/theme/route";

function post(body: unknown): Request {
  return new Request("http://localhost/api/theme", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/theme", () => {
  it("400s on an empty prompt", async () => {
    const res = await POST(post({ prompt: "" }));
    expect(res.status).toBe(400);
  });
  it("returns the generated spec", async () => {
    generateTheme.mockResolvedValue({ name: "Neo" });
    const res = await POST(post({ prompt: "matrix" }));
    expect(res.status).toBe(200);
    expect((await res.json()).spec.name).toBe("Neo");
  });
});
