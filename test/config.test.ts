import { describe, it, expect, vi } from "vitest";
import { costUsd } from "../src/config.js";

describe("cost", () => {
  it("computes token cost from the pricing table", () => {
    // sonnet: $3/1M in, $15/1M out → 1000 in + 1000 out
    expect(costUsd("claude-sonnet-4-6", 1_000_000, 0)).toBeCloseTo(3);
    expect(costUsd("claude-sonnet-4-6", 0, 1_000_000)).toBeCloseTo(15);
  });
  it("unknown model costs 0 (safe default) and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(costUsd("nope", 1000, 1000)).toBe(0);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
