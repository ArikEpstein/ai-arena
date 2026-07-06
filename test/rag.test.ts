import { describe, it, expect, beforeAll } from "vitest";
import { initRag, answerWithRag } from "../src/rag.js";
import { VectorStore } from "../src/vectorStore.js";
import { chunk } from "../src/chunking.js";

describe("rag pipeline (mock)", () => {
  beforeAll(async () => { await initRag(); });

  it("retrieves grounded context with cited sources", async () => {
    const r = await answerWithRag("Do you ship to Australia?");
    expect(r.simulated).toBe(true);
    expect(r.sources.length).toBeGreaterThan(0);
    // At least one source must come from the shipping policy document (citation metadata).
    expect(r.sources.some((s) => s.source === "policy/shipping")).toBe(true);
    // Sources are returned in descending relevance order.
    expect(r.sources[0].score).toBeGreaterThanOrEqual(r.sources[r.sources.length - 1].score);
    expect(r.answer).toContain("retrieved context");
  });
});

describe("vectorStore", () => {
  it("ranks the most similar chunk first and respects topK", async () => {
    const store = new VectorStore();
    await store.addChunks(chunk("doc", "We ship to Europe and the US. Returns are accepted within 30 days.", { max: 40 }));
    expect(store.size).toBeGreaterThan(0);
    const hits = await store.search("shipping to Europe", 2);
    expect(hits.length).toBeLessThanOrEqual(2);
    expect(hits.length).toBeGreaterThan(0);
    // Scores are sorted highest-first; every hit carries citation metadata.
    expect(hits[0].score).toBeGreaterThanOrEqual(hits[hits.length - 1].score);
    expect(hits.every((h) => h.meta.source === "doc")).toBe(true);
  });
  it("returns no hits when the store is empty", async () => {
    const store = new VectorStore();
    expect(store.size).toBe(0);
    expect(await store.search("anything", 3)).toEqual([]);
  });
});
