import { describe, it, expect } from "vitest";
import { chunk } from "../src/chunking.js";

describe("chunking", () => {
  it("keeps short text as one chunk with metadata", () => {
    const c = chunk("doc/a", "A short sentence.", { max: 400 });
    expect(c).toHaveLength(1);
    expect(c[0].meta).toEqual({ source: "doc/a", index: 0 });
  });
  it("splits long text and carries overlap between chunks", () => {
    const long = Array.from({ length: 20 }, (_, i) => `Paragraph number ${i} with content.`).join("\n\n");
    const c = chunk("doc/b", long, { max: 120, overlap: 30 });
    expect(c.length).toBeGreaterThan(1);
    expect(c.every((x) => x.meta.source === "doc/b")).toBe(true);
  });
  it("does not duplicate buffered text when a segment exceeds max (no overlap)", () => {
    // A short prefix buffers, then an oversized token forces a hard cut — the prefix must appear once.
    const text = "alpha beta gamma " + "Z".repeat(80) + " delta epsilon";
    const c = chunk("doc/c", text, { max: 30, overlap: 0 });
    const joined = c.map((x) => x.text).join(" ");
    expect((joined.match(/alpha/g) || []).length).toBe(1);
    expect((joined.match(/delta/g) || []).length).toBe(1);
  });
});
