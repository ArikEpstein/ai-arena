import { describe, it, expect } from "vitest";
import { runAgent } from "../src/agent.js";

const cfg = (mock?: any) => ({ label: "t", model: "claude-sonnet-4-6", mock });

describe("agent loop (mock)", () => {
  it("calls the right tool and answers", async () => {
    const r = await runAgent("Who is customer c-77 and how many points do they have?", cfg({ chains: true, reasons: true, refuses: true }));
    expect(r.trace.map((t) => t.tool)).toContain("lookup_customer");
    expect(r.answer).toContain("240");
  });
  it("weak profile cannot chain two tools", async () => {
    const r = await runAgent("How many points are earned on the monthly revenue of store 1003?", cfg({ chains: false }));
    const tools = r.trace.map((t) => t.tool);
    expect(tools).toContain("get_store_stats");
    expect(tools).not.toContain("calculate_points");
  });
  it("tracks usage/cost across the loop", async () => {
    const r = await runAgent("What is the revenue of store 1002?", cfg());
    expect(r.usage.inTok).toBeGreaterThan(0);
    expect(r.usage.outTok).toBeGreaterThan(0);
    expect(r.usage.costUsd).toBeGreaterThan(0);
  });
});
