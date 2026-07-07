// src/agent.ts — the agentic loop. Also returns a trace and usage/latency — because without
// measurement there is no Arena and no observability. The prompt comes from the config (cfg.systemPrompt).
import { complete, type Msg, type Block, type RunConfig, type Usage } from "./llm.js";
import { TOOLS, runTool } from "./tools.js";
import { MODE, MODEL_LATENCY } from "./config.js";

// Default prompt (used when the config provides none). In the Arena we inject our own v1/v2.
export const DEFAULT_SYSTEM = `You are a support assistant for a loyalty platform. Use the tools to fetch real data.
Never invent numbers. If information is missing, say that you don't know.`;

const MAX_STEPS = 5;

export interface TraceStep { tool: string; args: unknown; result: unknown; }
export interface AgentResult {
  answer: string; trace: TraceStep[]; usage: Usage;
  latencyMs: number; simulatedLatency: boolean;
}

export async function runAgent(question: string, cfg: RunConfig): Promise<AgentResult> {
  const system = cfg.systemPrompt ?? DEFAULT_SYSTEM;
  const messages: Msg[] = [{ role: "user", content: question }];
  const trace: TraceStep[] = [];
  const usage: Usage = { inTok: 0, outTok: 0, costUsd: 0 };
  const start = Date.now();

  for (let step = 0; step < MAX_STEPS; step++) {
    const { blocks, usage: u } = await complete(cfg, system, messages, TOOLS);
    usage.inTok += u.inTok; usage.outTok += u.outTok; usage.costUsd += u.costUsd;

    const toolUses = blocks.filter((b) => b.type === "tool_use") as Extract<Block, { type: "tool_use" }>[];
    if (toolUses.length === 0) {
      const textBlock = blocks.find((b) => b.type === "text") as Extract<Block, { type: "text" }> | undefined;
      return finalize(textBlock?.text ?? "", trace, usage, start, cfg, question);
    }
    // Push the full assistant turn (any text preamble + the tool_use blocks), not just the tool calls,
    // so the model keeps its own reasoning in the conversation history on later live steps.
    messages.push({ role: "assistant", content: blocks });
    const results = toolUses.map((tu) => {
      const result = runTool(tu.name, tu.input);
      trace.push({ tool: tu.name, args: tu.input, result });
      // The Anthropic API requires tool_result content to be a string (or content blocks),
      // never a bare object. Serialize here; the mock policy parses it back.
      return { type: "tool_result" as const, tool_use_id: tu.id, content: JSON.stringify(result) };
    });
    messages.push({ role: "user", content: results });
  }
  return finalize("Stopped: exceeded the maximum number of steps.", trace, usage, start, cfg, question);
}

function finalize(answer: string, trace: TraceStep[], usage: Usage, start: number, cfg: RunConfig, question: string): AgentResult {
  const real = Date.now() - start;
  const sim = MODE === "mock";
  // Simulated latency = model baseline + deterministic per-question jitter. Keying the jitter off the
  // question (not the answer/prompt) means two prompts on the same model get identical latency — a clean A/B.
  const simMs = (MODEL_LATENCY[cfg.model] ?? 600) + (question.length % 50);
  return { answer, trace, usage, latencyMs: sim ? simMs : real, simulatedLatency: sim };
}
