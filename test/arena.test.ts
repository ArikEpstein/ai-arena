import { describe, it, expect } from "vitest";
import { runScenario, SCENARIOS, type ScenarioPayload } from "../evals/arena.js";

// Runs in mock mode. config.ts computes MODE at import time (LLM_MODE=live + a key → live, else
// mock), and the `npm test` script forces LLM_MODE=mock ANTHROPIC_API_KEY= — so mock is in effect
// before this module loads. runScenario() is pure (no file writes / console / exit), so importing
// arena.ts is side-effect-free thanks to the entry-point guard on main().
describe("arena scenarios (mock)", () => {
  it("prompts: v1 scores 50%, v2 scores 100% — a same-model prompt win", async () => {
    const p = await runScenario("prompts");
    const [v1, v2] = p.summary;
    expect(v1.passRate).toBe(50);   // weak profile fails refuse/no-hallucinate/chain/reasoning → 4/8
    expect(v2.passRate).toBe(100);  // strong profile passes all 8
    expect(p.sameModel).toBe(true);
    expect(v1.model).toBe(v2.model); // truly the same model
  });

  it("models: Haiku, Sonnet, Opus all score 100% — a genuine tie; cost rises with the model tier", async () => {
    const p = await runScenario("models");
    expect(p.summary.map((s) => s.model)).toEqual([
      "claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-8",
    ]);
    expect(p.summary.every((s) => s.passRate === 100)).toBe(true);
    // The whole point of the model comparison: quality ties, so the lever is cost — cheapest wins.
    const [haiku, sonnet, opus] = p.summary;
    expect(haiku.totalCostUsd).toBeLessThan(sonnet.totalCostUsd);
    expect(sonnet.totalCostUsd).toBeLessThan(opus.totalCostUsd);
  });

  it("iterations: v1 → v2 → v3 measures 50 → 100 → 100", async () => {
    const p = await runScenario("iterations");
    expect(p.summary.map((s) => s.passRate)).toEqual([50, 100, 100]);
  });

  it("every scenario carries its prompt text and a non-empty verdict", async () => {
    for (const key of Object.keys(SCENARIOS)) {
      const p: ScenarioPayload = await runScenario(key);
      expect(p.verdict.length).toBeGreaterThan(0);
      expect(p.tab.length).toBeGreaterThan(0);
      expect(p.frame.length).toBeGreaterThan(0);
      // systemPrompt must reach the payload so the dashboard can show what actually differs.
      expect(p.runners.every((r) => typeof r.systemPrompt === "string" && r.systemPrompt.length > 0)).toBe(true);
    }
  });

  it("a combined build covers all three scenarios", async () => {
    const scenarios = await Promise.all(Object.keys(SCENARIOS).map((k) => runScenario(k)));
    expect(scenarios.map((s) => s.scenario).sort()).toEqual(["iterations", "models", "prompts"]);
  });

  it("rejects an unknown scenario", async () => {
    await expect(runScenario("nope")).rejects.toThrow(/Unknown scenario/);
  });
});
