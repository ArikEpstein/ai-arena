import { describe, it, expect, vi, afterEach } from "vitest";
import { rerank } from "../src/rerank.js";
import type { Hit } from "../src/vectorStore.js";

const hit = (text: string): Hit => ({ text, meta: { source: "doc", index: 0 }, score: 0 });

// These exercise the LIVE Voyage path (VOYAGE_API_KEY set) that the keyless unit tests never reach —
// the exact blind spot that once let rerank read the wrong response field and silently no-op.
describe("rerank (Voyage response parsing)", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("reorders hits by Voyage's `data` field (not `results`)", async () => {
    // Voyage returns { data: [{ index, relevance_score }] }. Reading `data.results` (the old bug)
    // throws → identity fallback → this reordering assertion fails. This test locks the shape.
    vi.stubEnv("VOYAGE_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [
        { index: 2, relevance_score: 0.9 },
        { index: 0, relevance_score: 0.5 },
      ] }),
    })));

    const out = await rerank("q", [hit("alpha"), hit("beta"), hit("gamma")], 2);
    expect(out.map((h) => h.text)).toEqual(["gamma", "alpha"]);
    expect(out.map((h) => h.score)).toEqual([0.9, 0.5]);
  });

  it("falls back to identity order when Voyage errors (never throws to the caller)", async () => {
    vi.stubEnv("VOYAGE_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, text: async () => "boom" })));
    const out = await rerank("q", [hit("alpha"), hit("beta"), hit("gamma")], 2);
    expect(out.map((h) => h.text)).toEqual(["alpha", "beta"]);
  });
});
