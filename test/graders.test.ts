import { describe, it, expect } from "vitest";
import { grade } from "../evals/graders.js";

describe("graders", () => {
  it("passes when expected tool + substring present", () => {
    const g = grade({ id: "x", question: "q", expectsTool: "lookup_customer", answerContains: "240" },
      { answer: "There are 240 points", trace: [{ tool: "lookup_customer" }] });
    expect(g.pass).toBe(true);
  });
  it("fails a missing chained tool (trace-based, not substring)", () => {
    const g = grade({ id: "x", question: "q", expectsAllTools: ["get_store_stats", "calculate_points"] },
      { answer: "61000", trace: [{ tool: "get_store_stats" }] });
    expect(g.pass).toBe(false); // "6100" is a substring of "61000" — trace check prevents false pass
  });
  it("flags a forbidden tool call", () => {
    const g = grade({ id: "x", question: "q", expectsTool: null, answerContains: "enough information" },
      { answer: "I don't have enough information", trace: [{ tool: "get_store_stats" }] });
    expect(g.pass).toBe(false);
  });
  it("forbidStrayNumbers: passes when only the queried id 9999 appears", () => {
    const g = grade({ id: "no-hallucinate", question: "What is the revenue of store 9999?", forbidStrayNumbers: true },
      { answer: "I don't have data for store 9999.", trace: [] });
    expect(g.pass).toBe(true);
  });
  it("forbidStrayNumbers: flags an invented number", () => {
    const g = grade({ id: "no-hallucinate", question: "What is the revenue of store 9999?", forbidStrayNumbers: true },
      { answer: "Store 9999 earned 88000 last month.", trace: [] });
    expect(g.pass).toBe(false); // 88000 is not the queried id — likely invented
  });
  it("numeric answerContains matches a comma-formatted number", () => {
    // A real model writes "95,000"; the golden value is "95000". Thousands separators must not fail it.
    const g = grade({ id: "x", question: "q", expectsTool: "get_store_stats", answerContains: "95000" },
      { answer: "The monthly revenue is ₪95,000.", trace: [{ tool: "get_store_stats" }] });
    expect(g.pass).toBe(true);
  });
  it("numeric answerContains does not falsely match a longer number", () => {
    // "35" must not be satisfied by "350" alone (the purchase amount)
    const g = grade({ id: "x", question: "q", expectsTool: "calculate_points", answerContains: "35" },
      { answer: "A purchase of 350 was made", trace: [{ tool: "calculate_points" }] });
    expect(g.pass).toBe(false);
  });
});
