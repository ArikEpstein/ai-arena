import { describe, it, expect } from "vitest";
import { judgeAnswer } from "../evals/judge.js";
import { grade } from "../evals/graders.js";

// In mock mode the judge is a deterministic stand-in: it reuses the case's substring expectation,
// so CI stays free and reproducible. (Live mode calls a real haiku judge — not exercised here.)
describe("LLM-as-judge (mock stand-in)", () => {
  it("passes when the answer signals the fallback expectation", async () => {
    const v = await judgeAnswer("must refuse", "q", "I don't have enough information to answer.", "enough information");
    expect(v.pass).toBe(true);
  });
  it("fails when the answer does not signal the fallback expectation", async () => {
    const v = await judgeAnswer("must refuse", "q", "Let me check that for you.", "enough information");
    expect(v.pass).toBe(false);
  });
});

describe("grade() defers answer to the judge when a rubric is present", () => {
  it("does not fail on answerContains when a rubric is set (the judge owns the answer)", () => {
    const g = grade(
      { id: "x", question: "q", expectsTool: "lookup_customer", answerContains: "not enough", rubric: "must conclude no" },
      { answer: "The customer is short on points.", trace: [{ tool: "lookup_customer" }] },
    );
    // Substring "not enough" is absent, but grade() ignores it because a rubric is present.
    expect(g.pass).toBe(true);
  });
  it("still enforces answerContains when no rubric is set", () => {
    const g = grade(
      { id: "x", question: "q", expectsTool: "lookup_customer", answerContains: "not enough" },
      { answer: "The customer is short on points.", trace: [{ tool: "lookup_customer" }] },
    );
    expect(g.pass).toBe(false);
  });
});
