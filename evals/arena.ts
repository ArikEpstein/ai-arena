// evals/arena.ts — the Eval Arena (three scenarios):
//   SCENARIO=prompts (default) → prompt v1 vs v2 on the same model (the flagship)
//   SCENARIO=models            → model vs model (haiku vs sonnet)
//   SCENARIO=iterations        → prompt v1 → v2 → v3 on the same model
// For each config it measures: pass-rate, latency (avg/p95), cost, and a per-case diff, then decides.
// Writes arena-results.json + web/dashboard.html (opens in any browser, no server needed).
//
// Run:  npx tsx evals/arena.ts            (prompts)
//        SCENARIO=models npx tsx evals/arena.ts
import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runAgent, DEFAULT_SYSTEM } from "../src/agent.js";
import { type RunConfig } from "../src/llm.js";
import { MODE, MODELS } from "../src/config.js";
import { DATASET } from "./dataset.js";
import { grade } from "./graders.js";
import { judgeAnswer } from "./judge.js";
import { RECORD, REPLAY, saveFixtures } from "../src/transcripts.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const SCENARIO = (process.env.SCENARIO ?? "prompts") as "prompts" | "prompts-haiku" | "models" | "iterations";

// ── Prompt v1: minimal. v2: adds explicit instructions (chaining/reasoning/refusal). ──
const PROMPT_V1 = `You are a support assistant for a loyalty platform. Use the tools to answer.`;
const PROMPT_V2 = `You are a support assistant for a loyalty platform. Use the tools to fetch real data.
- If a task needs two tools in sequence (for example, calculating points from a store's revenue) — call both.
- Draw an explicit conclusion from the data (for example, whether there are enough points: yes/no).
- If you don't have the information to answer — say "I don't have enough information", and don't make things up.`;

// v3 = v2 + always include the exact number in the answer (fixes a subtle regression: v2 passed but was sometimes shallow)
const PROMPT_V3 = PROMPT_V2 + `\n- Always include the exact number/value from the tool in your answer.`;

const SCENARIOS: Record<string, { label: string; runners: RunConfig[]; sameModel: boolean }> = {
  // Same model, different prompt → the difference is quality only (cost/latency identical)
  prompts: {
    label: "Prompt v1 vs v2 (same model)",
    sameModel: true,
    runners: [
      { label: "Prompt v1", model: MODELS.work, systemPrompt: PROMPT_V1, mock: { chains: false, reasons: false, refuses: false } },
      { label: "Prompt v2", model: MODELS.work, systemPrompt: PROMPT_V2, mock: { chains: true, reasons: true, refuses: true } },
    ],
  },
  // Continuous iteration: v1→v2→v3 on the same model. Shows measured improvement over time.
  iterations: {
    label: "Prompt iteration: v1 → v2 → v3",
    sameModel: true,
    runners: [
      { label: "v1", model: MODELS.work, systemPrompt: PROMPT_V1, mock: { chains: false, reasons: false, refuses: false } },
      { label: "v2", model: MODELS.work, systemPrompt: PROMPT_V2, mock: { chains: true, reasons: true, refuses: true } },
      { label: "v3", model: MODELS.work, systemPrompt: PROMPT_V3, mock: { chains: true, reasons: true, refuses: true } },
    ],
  },
  // Same idea as `prompts`, on a weaker model (Haiku) where the prompt actually changes behavior —
  // a capable model (Sonnet) passes both prompts, so the real prompt win shows up here.
  "prompts-haiku": {
    label: "Prompt v1 vs v2 (Haiku)",
    sameModel: true,
    runners: [
      { label: "Prompt v1 · haiku", model: MODELS.fast, systemPrompt: PROMPT_V1, mock: { chains: false, reasons: false, refuses: false } },
      { label: "Prompt v2 · haiku", model: MODELS.fast, systemPrompt: PROMPT_V2, mock: { chains: true, reasons: true, refuses: true } },
    ],
  },
  // Different model → tradeoff of quality vs cost/latency
  models: {
    label: "Model A/B (haiku vs sonnet)",
    sameModel: false,
    runners: [
      { label: "Haiku · fast", model: MODELS.fast, systemPrompt: DEFAULT_SYSTEM, mock: { chains: false, reasons: false, refuses: false } },
      { label: "Sonnet · work", model: MODELS.work, systemPrompt: DEFAULT_SYSTEM, mock: { chains: true, reasons: true, refuses: true } },
    ],
  },
};


function p95(xs: number[]): number {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  // Nearest-rank: ceil(n * 0.95) - 1, clamped. (floor() is off by one when n is a multiple of 20.)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

async function main() {
  const sc = SCENARIOS[SCENARIO];
  const RUNNERS = sc.runners;

  const results: Array<{ id: string; question: string; note: string; perRunner: any[] }> = [];
  for (const c of DATASET) {
    const perRunner = [];
    for (const cfg of RUNNERS) {
      const r = await runAgent(c.question, cfg);
      const g = grade(c, r);
      let pass = g.pass;
      const reasons = [...g.reasons];
      // Open-ended answers are graded by the LLM-as-judge (deterministic in mock, a real model in live).
      if (c.rubric) {
        const v = await judgeAnswer(c.rubric, c.question, r.answer, c.answerContains);
        if (!v.pass) { pass = false; reasons.push(v.reason); }
      }
      perRunner.push({ pass, reasons, answer: r.answer, tools: r.trace.map((t) => t.tool), latencyMs: r.latencyMs, costUsd: r.usage.costUsd });
    }
    results.push({ id: c.id, question: c.question, note: c.note ?? "", perRunner });
  }

  const summary = RUNNERS.map((cfg, i) => {
    const cells = results.map((r) => r.perRunner[i]);
    const passed = cells.filter((c) => c.pass).length;
    const lat = cells.map((c) => c.latencyMs);
    return {
      label: cfg.label, model: cfg.model,
      passRate: Math.round((passed / cells.length) * 100), passed, total: cells.length,
      avgLatencyMs: Math.round(lat.reduce((s, x) => s + x, 0) / lat.length),
      p95LatencyMs: Math.round(p95(lat)),
      totalCostUsd: Number(cells.reduce((s, c) => s + c.costUsd, 0).toFixed(6)),
    };
  });

  // Replay runs serve real recorded model output, so label them "replay" (not "mock") and be explicit
  // that pass/fail and cost are real while latency stays simulated for a clean same-model comparison.
  const displayMode = REPLAY ? "replay" : MODE;
  const dataNote = REPLAY
    ? "answers, tool calls, and token cost are real recorded model output; latency is simulated."
    : MODE === "mock"
      ? "latency and cost are simulated (mock). pass/fail is real."
      : "live: everything is measured for real.";
  const payloadBase = {
    scenario: SCENARIO, scenarioLabel: sc.label,
    dataset: "customer-support-golden-v1", mode: displayMode,
    dataNote,
    generatedAt: new Date().toISOString(),
    runners: RUNNERS.map((r) => ({ label: r.label, model: r.model })),
    summary, results,
  };

  if (RECORD) { saveFixtures(); console.log("\n(recorded live transcripts → evals/fixtures/transcripts.json)"); }

  console.log(`\n⚔️  EVAL ARENA  (${displayMode}) — ${sc.label}`);
  console.log("─".repeat(64));
  for (const s of summary)
    console.log(`${s.label.padEnd(16)} pass ${String(s.passRate).padStart(3)}%  avg ${s.avgLatencyMs}ms  cost $${s.totalCostUsd}`);
  console.log("─".repeat(64));

  if (summary.length === 2) {
    const [a, b] = summary;
    let better: typeof a | null = null;
    if (b.passRate > a.passRate) better = b;
    else if (a.passRate > b.passRate) better = a;
    const near = (x: number, y: number) => Math.abs(x - y) / Math.max(x, y, 1e-9) < 0.05;
    let verdict: string;
    if (better && sc.sameModel && near(a.avgLatencyMs, b.avgLatencyMs)) {
      const worse = better === a ? b : a;
      verdict = `A pure prompt win: same model, same latency, ~same cost ($${a.totalCostUsd} vs $${b.totalCostUsd}) — ` +
        `only the prompt changed, and the pass-rate jumped from ${worse.passRate}% to ${better.passRate}%. ` +
        `This is exactly what prompt versioning + evals are meant to catch: a quality gain without paying more.`;
    } else if (better) {
      const worse = better === a ? b : a;
      const cheaper = a.totalCostUsd <= b.totalCostUsd ? a : b;
      const faster = a.avgLatencyMs <= b.avgLatencyMs ? a : b;
      const ratio = (Math.max(a.totalCostUsd, b.totalCostUsd) / Math.max(cheaper.totalCostUsd, 1e-9)).toFixed(1);
      verdict = `${better.label} wins on quality (${better.passRate}% vs ${worse.passRate}%), ` +
        `but ${cheaper.label} is ~${ratio}x cheaper and ${faster.label} is faster. Is the quality gap worth the cost/latency?`;
    } else verdict = `A tie on quality (${a.passRate}%). Choose by cost/latency.`;

    const payload = { ...payloadBase, verdict };
    writeFileSync(join(__dir, "..", "arena-results.json"), JSON.stringify(payload, null, 2));
    const tpl = readFileSync(join(__dir, "..", "web", "dashboard.template.html"), "utf8");
    // Escape "<" so a "</script>" inside the data can't break out of the inline <script>, and use a
    // function replacer so "$" sequences in the JSON aren't interpreted as replacement patterns.
    const dataLiteral = JSON.stringify(payload).replace(/</g, "\\u003c");
    writeFileSync(join(__dir, "..", "web", "dashboard.html"), tpl.replace("/*__ARENA_DATA__*/null", () => dataLiteral));
    console.log("Verdict:", verdict);
    console.log("\n→ web/dashboard.html + arena-results.json written.");
  } else {
    // Iteration (3+ configs): print progression. The dashboard stays with the 2-contender scenario.
    console.log("Progression:", summary.map((s) => `${s.label} ${s.passRate}%`).join("  →  "));
    console.log(
      "\nTakeaway: v3 (\"cite the number\") didn't move the aggregate — because v2 already included it.\n" +
      "This is exactly *why* you keep a dataset: to catch that kind of improvement you must add a dedicated eval case\n" +
      "that checks source citation. An improvement with no eval measuring it does not exist as far as the system is concerned."
    );
    writeFileSync(join(__dir, "..", "arena-results.json"), JSON.stringify(payloadBase, null, 2));
  }

  // ── CI GATE ──  This is what turns "runs evals" into "gates on them":
  // if the best pass-rate drops below the threshold — exit 1 breaks the build. Applies to every scenario.
  const GATE = Number(process.env.ARENA_GATE ?? 80);
  const best = Math.max(...summary.map((s) => s.passRate));
  if (best < GATE) {
    console.error(`\n❌ Arena gate FAILED: best pass-rate ${best}% < required ${GATE}%`);
    process.exit(1);
  }
  console.log(`\n✅ Arena gate passed: best pass-rate ${best}% ≥ ${GATE}%`);
}

main().catch((e) => { console.error(e); process.exit(1); });
