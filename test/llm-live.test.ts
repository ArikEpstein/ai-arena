import { describe, it, expect, vi } from "vitest";

// Guards the LIVE Anthropic path that keyless unit tests skip: the mock uses inTok/outTok, but the
// real API returns input_tokens/output_tokens — a swap or transposition would silently corrupt every
// cost/latency number the Arena reports. We mock the SDK and force MODE=live to exercise that mapping.
const create = vi.hoisted(() => vi.fn());
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create }; } }));
vi.mock("../src/config.js", async (orig) => ({
  ...(await orig<typeof import("../src/config.js")>()),
  MODE: "live", // costUsd/PRICING stay real; only the mode switch is overridden
}));

describe("liveComplete usage-field mapping (live path)", () => {
  it("maps Anthropic input_tokens/output_tokens and content blocks", async () => {
    create.mockResolvedValue({
      content: [
        { type: "text", text: "hello" },
        { type: "tool_use", id: "tu_1", name: "lookup_customer", input: { customer_id: "c-77" } },
      ],
      usage: { input_tokens: 123, output_tokens: 45 },
    });

    const { complete } = await import("../src/llm.js");
    const c = await complete(
      { label: "t", model: "claude-sonnet-4-6" }, "sys", [{ role: "user", content: "hi" }], [],
    );

    expect(c.usage.inTok).toBe(123);
    expect(c.usage.outTok).toBe(45);
    // sonnet pricing: $3/1M in + $15/1M out — a transposed in/out mapping fails this.
    expect(c.usage.costUsd).toBeCloseTo((123 / 1e6) * 3 + (45 / 1e6) * 15, 12);
    expect(c.blocks).toEqual([
      { type: "text", text: "hello" },
      { type: "tool_use", id: "tu_1", name: "lookup_customer", input: { customer_id: "c-77" } },
    ]);
  });
});
