import { describe, it, expect } from "vitest";
import { fixtureKey } from "../src/transcripts.js";

// The record/replay store keys recordings by a content hash of the request, so replay reconstructs
// the exact recorded run. These invariants (determinism + collision-resistance) are what make it work.
describe("transcripts fixtureKey", () => {
  it("is deterministic for equal requests", () => {
    const req = { t: "complete", model: "claude-sonnet-4-6", messages: [{ role: "user", content: "hi" }] };
    expect(fixtureKey(req)).toBe(fixtureKey({ ...req }));
  });
  it("differs for different requests", () => {
    expect(fixtureKey({ a: 1 })).not.toBe(fixtureKey({ a: 2 }));
  });
  it("is a short hex string", () => {
    expect(fixtureKey({ a: 1 })).toMatch(/^[0-9a-f]{20}$/);
  });
});
