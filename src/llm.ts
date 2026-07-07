// src/llm.ts — the model-call layer. Uniform contract: complete() returns blocks + usage.
// live: real Anthropic (with the config's systemPrompt). mock: a deterministic policy
// driven by a "behavior profile" — so that both model comparisons and prompt comparisons
// produce a *real* difference in the numbers without an API key.
import type AnthropicSDK from "@anthropic-ai/sdk";
import { MODE, MODELS, costUsd } from "./config.js";
import { RECORD, REPLAY, fixtureKey, replayGet, recordPut } from "./transcripts.js";
import type { Tool } from "./tools.js";

export type Block =
  | { type: "tool_use"; id: string; name: string; input: any }
  | { type: "text"; text: string };
export type Msg =
  | { role: "user"; content: string | any[] }
  | { role: "assistant"; content: Block[] };

export interface Usage { inTok: number; outTok: number; costUsd: number; }
export interface Completion { blocks: Block[]; usage: Usage; }

// Profile that simulates what the prompt/model is "capable" of. Unused in live — the real model decides.
export interface MockProfile { chains?: boolean; reasons?: boolean; refuses?: boolean; }

// A run config the Arena compares. systemPrompt differs between prompt v1/v2; model between models.
export interface RunConfig {
  label: string;
  model: string;
  systemPrompt?: string;   // the spec that runs in production (live)
  mock?: MockProfile;      // what the prompt/model triggers (mock)
}

// ---------- LIVE ----------
// Lazily import the SDK so the mock path never needs the dependency (or an API key).
export async function anthropicClient() {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  return new Anthropic();
}

async function liveComplete(cfg: RunConfig, system: string, messages: Msg[], tools: Tool[]): Promise<Completion> {
  const client = await anthropicClient();
  const res = await client.messages.create({
    model: cfg.model,
    max_tokens: 1024,
    system,
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as AnthropicSDK.Tool.InputSchema,
    })),
    messages: messages as AnthropicSDK.MessageParam[],
  });
  const blocks: Block[] = [];
  for (const b of res.content) {
    if (b.type === "tool_use") blocks.push({ type: "tool_use", id: b.id, name: b.name, input: b.input });
    else if (b.type === "text") blocks.push({ type: "text", text: b.text });
    // Other block types (e.g. thinking) are never requested here; skip rather than coerce.
  }
  const inTok = res.usage.input_tokens, outTok = res.usage.output_tokens;
  return { blocks, usage: { inTok, outTok, costUsd: costUsd(cfg.model, inTok, outTok) } };
}

// ---------- MOCK ----------
let idc = 0;
const tid = () => `tu_${++idc}`;

function mockComplete(cfg: RunConfig, messages: Msg[]): Completion {
  const prof: MockProfile = cfg.mock ?? { chains: true, reasons: true, refuses: true };
  // One pass over the history collects everything the policy needs: the last user text,
  // which tools have already been called, and the accumulated tool results.
  let lastUser = "";
  const already = new Set<string>();
  const toolResults: any[] = [];
  for (const m of messages) {
    if (m.role === "user" && typeof m.content === "string") lastUser = m.content;
    if (m.role === "assistant" && Array.isArray(m.content))
      for (const b of m.content) if (b.type === "tool_use") already.add(b.name);
    if (m.role === "user" && Array.isArray(m.content))
      for (const b of m.content)
        if (b?.type === "tool_result")
          toolResults.push(typeof b.content === "string" ? JSON.parse(b.content) : b.content);
  }
  const text = lastUser.toLowerCase();

  const wrap = (blocks: Block[]): Completion => {
    const inTok = Math.max(20, lastUser.length + toolResults.length * 30);
    const outTok = 40 + blocks.filter((b) => b.type === "text").length * 20;
    return { blocks, usage: { inTok, outTok, costUsd: costUsd(cfg.model, inTok, outTok) } };
  };

  // --- Basic tools (any reasonable prompt/model knows these) ---
  const store = lastUser.match(/\b(10\d{2})\b/);
  if (store && !already.has("get_store_stats"))
    return wrap([{ type: "tool_use", id: tid(), name: "get_store_stats", input: { store_id: store[1] } }]);

  const cust = text.match(/\b(c-\d+)\b/); // text is lower-cased, so "C-77" normalizes to "c-77"
  if (cust && !already.has("lookup_customer"))
    return wrap([{ type: "tool_use", id: tid(), name: "lookup_customer", input: { customer_id: cust[1] } }]);

  // --- Cases with an explicit amount (basic, always) ---
  const amt = text.match(/(\d+(?:\.\d+)?)\s*(?:shekels?|₪|nis)/);
  if (text.includes("points") && amt && !already.has("calculate_points"))
    return wrap([{ type: "tool_use", id: tid(), name: "calculate_points", input: { amount_shekel: parseFloat(amt[1]) } }]);

  // --- Chaining a second tool (only if the prompt/model is capable) ---
  if (prof.chains && text.includes("points") && !already.has("calculate_points")) {
    const revenueHit = toolResults.find((r) => r && typeof r.monthly_revenue === "number");
    if (revenueHit)
      return wrap([{ type: "tool_use", id: tid(), name: "calculate_points", input: { amount_shekel: revenueHit.monthly_revenue } }]);
  }

  // --- Phrasing an answer from the results ---
  if (toolResults.length) {
    if (prof.reasons) {
      const pts = toolResults.find((r) => r && typeof r.points === "number");
      const need = (text.match(/(\d+)\s*points/) || [])[1];
      if (pts && need) {
        const verdict = pts.points >= parseInt(need, 10)
          ? "Yes, there are enough points"
          : "No, there are not enough points";
        return wrap([{ type: "text", text: `${verdict} (has ${pts.points}).` }]);
      }
    }
    return wrap([{ type: "text", text: `Based on the data: ${toolResults.map((r) => JSON.stringify(r)).join("; ")}` }]);
  }

  // --- No information: a good prompt refuses; a weak prompt stalls with empty reassurance ---
  return wrap([{ type: "text", text: prof.refuses ? "I don't have enough information to answer." : "Let me check that for you." }]);
}

export async function complete(cfg: RunConfig, system: string, messages: Msg[], tools: Tool[]): Promise<Completion> {
  // Record/replay real transcripts (keyed by the request content) so the Arena can gate on genuine
  // model behavior offline. Keyed on model+system+messages — the tool list is constant across calls.
  if (RECORD || REPLAY) {
    const key = fixtureKey({ t: "complete", model: cfg.model, system, messages });
    if (REPLAY) {
      const hit = replayGet<Completion>("completions", key);
      if (!hit) throw new Error(`No recorded completion for this request (${key}). Re-record with: npm run arena:record`);
      return hit;
    }
    const res = await liveComplete(cfg, system, messages, tools); // RECORD implies live
    recordPut("completions", key, res);
    return res;
  }
  if (MODE === "live") return liveComplete(cfg, system, messages, tools);
  return mockComplete(cfg, messages);
}

// stream() — for the chat endpoint
export async function* stream(text: string, cfg: RunConfig = { label: "chat", model: MODELS.work }) {
  if (MODE === "live") {
    const client = await anthropicClient();
    const s = client.messages.stream({
      model: cfg.model,
      max_tokens: 1024,
      ...(cfg.systemPrompt ? { system: cfg.systemPrompt } : {}),
      messages: [{ role: "user", content: text }],
    });
    for await (const ev of s)
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") yield ev.delta.text;
    return;
  }
  for (const w of `This is a streamed demo answer for: "${text}". In live mode this comes from a real model, token by token.`.split(" "))
    yield w + " ";
}
