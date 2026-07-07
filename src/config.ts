// src/config.ts — one place for every decision that changes: models, pricing, run mode.
// Why it matters: model names and prices change. Centralizing them = a one-line edit.
import "./env.js"; // load .env into process.env before MODE is computed (mock stays the default)

export type Mode = "mock" | "live";
export const MODE: Mode =
  process.env.LLM_MODE === "live" && process.env.ANTHROPIC_API_KEY ? "live" : "mock";

// Surface the easy-to-miss case: asked for live, but no key — so we're silently in mock.
if (process.env.LLM_MODE === "live" && !process.env.ANTHROPIC_API_KEY)
  console.warn("[config] LLM_MODE=live but ANTHROPIC_API_KEY is unset — running in mock mode (numbers are simulated).");

// Model IDs.
export const MODELS = {
  fast: "claude-haiku-4-5",   // cheap/fast — classification, routing, evals
  work: "claude-sonnet-4-6",  // the production default
  smart: "claude-opus-4-8",   // the strongest — reserved for complex tasks
} as const;

// Price list (USD per 1M tokens). Single source of truth for cost math in the Arena.
// Verify against https://docs.claude.com before relying on these numbers in production.
export const PRICING: Record<string, { in: number; out: number }> = {
  "claude-haiku-4-5": { in: 1.0, out: 5.0 },
  "claude-sonnet-4-6": { in: 3.0, out: 15.0 },
  "claude-opus-4-8": { in: 5.0, out: 25.0 },
};

// Embeddings: Anthropic has no embeddings endpoint of its own — Voyage is the recommended provider.
export const EMBED_MODEL = process.env.VOYAGE_EMBED_MODEL ?? "voyage-4"; // alternatives: voyage-3.5 / voyage-4-large
export const RERANK_MODEL = process.env.VOYAGE_RERANK_MODEL ?? "rerank-2.5";

export function costUsd(model: string, inTok: number, outTok: number): number {
  const p = PRICING[model];
  if (!p) {
    console.warn(`[config] no pricing for model "${model}" — cost reported as $0. Add it to PRICING.`);
    return 0;
  }
  return (inTok / 1e6) * p.in + (outTok / 1e6) * p.out;
}

// Simulated latency (ms) per model — mock mode only, clearly labeled in the dashboard.
export const MODEL_LATENCY: Record<string, number> = {
  "claude-haiku-4-5": 340,
  "claude-sonnet-4-6": 780,
  "claude-opus-4-8": 1200,
};
