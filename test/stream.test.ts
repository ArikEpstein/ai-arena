import { describe, it, expect } from "vitest";
import { stream } from "../src/llm.js";

// The /api/chat SSE endpoint consumes stream(). In mock mode it yields a demo answer
// word-by-word; this covers the only public surface that would otherwise be untested.
describe("stream (mock)", () => {
  it("yields a non-empty demo answer that echoes the prompt", async () => {
    let out = "";
    for await (const token of stream("hello world")) out += token;
    expect(out.trim().length).toBeGreaterThan(0);
    expect(out).toContain("hello world");
  });
});
