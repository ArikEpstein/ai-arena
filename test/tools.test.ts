import { describe, it, expect } from "vitest";
import { runTool } from "../src/tools.js";

describe("tools + Zod validation", () => {
  it("runs a valid tool call", () => {
    const r: any = runTool("get_store_stats", { store_id: "1002" });
    expect(r.monthly_revenue).toBe(95000);
  });
  it("rejects invalid args (guardrail: model output is untrusted)", () => {
    const r: any = runTool("calculate_points", { amount_shekel: -5 });
    expect(r.error).toBeDefined(); // nonnegative() fails
  });
  it("rejects wrong-typed args", () => {
    const r: any = runTool("calculate_points", { amount_shekel: "abc" });
    expect(r.error).toBeDefined();
  });
  it("handles unknown tool", () => {
    const r: any = runTool("nope", {});
    expect(r.error).toContain("unknown");
  });
  it("rejects unexpected extra keys (.strict guardrail)", () => {
    const r: any = runTool("get_store_stats", { store_id: "1002", admin: true });
    expect(r.error).toBeDefined();
  });
  it("returns a not-found error for an unknown store", () => {
    const r: any = runTool("get_store_stats", { store_id: "9999" });
    expect(r.error).toBe("store not found");
  });
  it("calculates points as 1 per 10 shekels (rounded)", () => {
    const r: any = runTool("calculate_points", { amount_shekel: 350 });
    expect(r.points).toBe(35);
  });
  it("looks up a known customer's points and tier", () => {
    const r: any = runTool("lookup_customer", { customer_id: "c-77" });
    expect(r.points).toBe(240);
    expect(r.tier).toBe("gold");
  });
  it("looks up a customer case-insensitively (a live model may send 'C-77')", () => {
    const r: any = runTool("lookup_customer", { customer_id: "C-77" });
    expect(r.customer_id).toBe("c-77");
    expect(r.name).toBe("Dana");
  });
  it("returns a not-found error for an unknown customer", () => {
    const r: any = runTool("lookup_customer", { customer_id: "c-00" });
    expect(r.error).toBe("customer not found");
  });
});
