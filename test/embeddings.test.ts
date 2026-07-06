import { describe, it, expect } from "vitest";
import { embed } from "../src/embeddings.js";

// These invariants hold for the local toy embedder used in mock mode (no VOYAGE_API_KEY).
// The whole mock RAG ranking rests on them: same text -> same vector, and unit length so
// cosine similarity is well-behaved.
describe("toy embedder (mock fallback)", () => {
  it("is deterministic for identical input", async () => {
    const [a] = await embed(["ship to europe"], "document");
    const [b] = await embed(["ship to europe"], "document");
    expect(a).toEqual(b);
  });
  it("returns unit-normalized vectors", async () => {
    const [v] = await embed(["ship to europe"], "query");
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });
});
