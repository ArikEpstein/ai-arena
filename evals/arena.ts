// evals/arena.ts — the Eval Arena (three scenarios, one dashboard):
//   prompts    → prompt v1 vs v2 on the same model      (test a prompt)
//   models     → model vs model, haiku vs sonnet         (choose a model: quality vs cost/latency)
//   iterations → prompt v1 → v2 → v3 on the same model   (iterate, and prove each step)
// For each config it measures pass-rate, latency (avg/p95), cost, and a per-case diff, then decides.
//
// `npm run arena` (mock) runs ALL THREE into one web/dashboard.html with a scenario selector.
// `SCENARIO=models npx tsx evals/arena.ts` runs a single scenario (record/replay are single-scenario too).
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

// ── Prompt v1: minimal. v2: adds explicit instructions (chaining/reasoning/refusal). ──
const PROMPT_V1 = `You are a support assistant for a loyalty platform. Use the tools to answer.`;
const PROMPT_V2 = `You are a support assistant for a loyalty platform. Use the tools to fetch real data.
- If a task needs two tools in sequence (for example, calculating points from a store's revenue) — call both.
- Draw an explicit conclusion from the data (for example, whether there are enough points: yes/no).
- If you don't have the information to answer — say "I don't have enough information", and don't make things up.`;

// v3 = v2 + always include the exact number in the answer (fixes a subtle regression: v2 passed but was sometimes shallow)
const PROMPT_V3 = PROMPT_V2 + `\n- Always include the exact number/value from the tool in your answer.`;

interface Scenario {
  tab: string;        // short label for the selector
  label: string;      // full scenario title
  frame: string;      // one-line plain-language framing for a non-expert
  sameModel: boolean;
  runners: RunConfig[];
}

export const SCENARIOS: Record<string, Scenario> = {
  // Same model, different prompt → the difference is quality only (cost/latency ~identical).
  prompts: {
    tab: "Prompt v1 vs v2",
    label: "Prompt v1 vs v2 (same model)",
    frame: "Same model, near-identical cost — the prompt is the only thing that changed. Did quality actually move?",
    sameModel: true,
    runners: [
      { label: "Prompt v1", model: MODELS.work, systemPrompt: PROMPT_V1, mock: { chains: false, reasons: false, refuses: false } },
      { label: "Prompt v2", model: MODELS.work, systemPrompt: PROMPT_V2, mock: { chains: true, reasons: true, refuses: true } },
    ],
  },
  // Different models → the quality vs cost/latency tradeoff. All runners get the SAME (strong) profile,
  // so the comparison is model-vs-model on equal capability: in mock the profile stands in for what a
  // model *can* do; handing one side a weaker profile would measure the profile, not the model. All three
  // land at 100% (modern Claude is quality-saturated on this golden set) — so the real lever is cost/latency.
  models: {
    tab: "Haiku vs Sonnet vs Opus",
    label: "Model comparison (Haiku vs Sonnet vs Opus)",
    frame: "Same job, three models. Quality ties — so the decision is pure cost and latency. Which do you ship?",
    sameModel: false,
    runners: [
      { label: "Haiku · fast", model: MODELS.fast, systemPrompt: DEFAULT_SYSTEM, mock: { chains: true, reasons: true, refuses: true } },
      { label: "Sonnet · work", model: MODELS.work, systemPrompt: DEFAULT_SYSTEM, mock: { chains: true, reasons: true, refuses: true } },
      { label: "Opus · smart", model: MODELS.smart, systemPrompt: DEFAULT_SYSTEM, mock: { chains: true, reasons: true, refuses: true } },
    ],
  },
  // Continuous iteration: v1→v2→v3 on the same model. Shows measured improvement — and that a change
  // with no eval measuring it (v3's "cite the number", already covered by v2) doesn't move the score.
  iterations: {
    tab: "Iteration v1→v2→v3",
    label: "Prompt iteration: v1 → v2 → v3",
    frame: "One prompt, three versions. Progress you can measure — not just claim.",
    sameModel: true,
    runners: [
      { label: "v1", model: MODELS.work, systemPrompt: PROMPT_V1, mock: { chains: false, reasons: false, refuses: false } },
      { label: "v2", model: MODELS.work, systemPrompt: PROMPT_V2, mock: { chains: true, reasons: true, refuses: true } },
      { label: "v3", model: MODELS.work, systemPrompt: PROMPT_V3, mock: { chains: true, reasons: true, refuses: true } },
    ],
  },
};

export interface RunnerSummary {
  label: string; model: string;
  passRate: number; passed: number; total: number;
  avgLatencyMs: number; p95LatencyMs: number; totalCostUsd: number;
}
export interface CaseCell {
  pass: boolean; reasons: string[]; answer: string; tools: string[]; latencyMs: number; costUsd: number;
}
export interface CaseResult { id: string; question: string; note: string; perRunner: CaseCell[]; }
export interface ScenarioPayload {
  scenario: string;
  tab: string;
  scenarioLabel: string;
  frame: string;
  sameModel: boolean;
  dataNote: string;
  runners: { label: string; model: string; systemPrompt: string }[];
  summary: RunnerSummary[];
  results: CaseResult[];
  verdict: string;
}

function p95(xs: number[]): number {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  // Nearest-rank: ceil(n * 0.95) - 1, clamped. (floor() is off by one when n is a multiple of 20.)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

// Pure and side-effect-free: run every dataset case through every runner, grade, and decide.
// No file writes, no console, no process.exit — so it's safe to import and unit-test.
export async function runScenario(key: string): Promise<ScenarioPayload> {
  const sc = SCENARIOS[key];
  if (!sc) throw new Error(`Unknown scenario "${key}" (expected one of ${Object.keys(SCENARIOS).join(", ")})`);
  const runners = sc.runners;

  const results: CaseResult[] = [];
  for (const c of DATASET) {
    const perRunner: CaseCell[] = [];
    for (const cfg of runners) {
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

  const summary: RunnerSummary[] = runners.map((cfg, i) => {
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

  // Replay serves real recorded model output; be explicit that pass/fail and cost are real while
  // latency stays simulated for a clean same-model comparison.
  const dataNote = REPLAY
    ? "answers, tool calls, and token cost are real recorded model output; latency is simulated."
    : MODE === "mock"
      ? "pass/fail and tool calls are real & deterministic; latency and cost are simulated."
      : "live: everything is measured for real.";

  return {
    scenario: key,
    tab: sc.tab,
    scenarioLabel: sc.label,
    frame: sc.frame,
    sameModel: sc.sameModel,
    dataNote,
    runners: runners.map((r) => ({ label: r.label, model: r.model, systemPrompt: r.systemPrompt ?? DEFAULT_SYSTEM })),
    summary,
    results,
    verdict: decideVerdict(summary, sc.sameModel),
  };
}

// The decision the Arena exists to make. Model comparison (any N) → a cost/latency call once quality
// is settled; same-model prompt A/B → a prompt-win/tie; 3+ same-model versions → a progression read.
// Always returns a non-empty string.
function decideVerdict(summary: RunnerSummary[], sameModel: boolean): string {
  const rates = summary.map((s) => s.passRate);
  const allTie = rates.every((r) => r === rates[0]);
  const cheapest = summary.reduce((a, b) => (b.totalCostUsd < a.totalCostUsd ? b : a));
  const priciest = summary.reduce((a, b) => (b.totalCostUsd > a.totalCostUsd ? b : a));
  const fastest = summary.reduce((a, b) => (b.avgLatencyMs < a.avgLatencyMs ? b : a));
  const ratio = (priciest.totalCostUsd / Math.max(cheapest.totalCostUsd, 1e-9)).toFixed(1);

  // Model comparison (2 or more models). Quality-saturated → the decision is cost/latency.
  if (!sameModel) {
    if (allTie) {
      return `A tie on quality (${rates[0]}%) across ${summary.length} models. The decision is pure cost/latency: ` +
        `${cheapest.label} is ~${ratio}× cheaper than ${priciest.label}` +
        `${fastest.label === cheapest.label ? " and the fastest" : ""}. Ship ${cheapest.label}.`;
    }
    const best = summary.reduce((a, b) => (b.passRate > a.passRate ? b : a));
    return `${best.label} leads on quality (${best.passRate}%), but ${cheapest.label} is ~${ratio}× cheaper` +
      `${fastest.label === cheapest.label ? " and faster" : ""}. Is the quality gap worth the cost/latency?`;
  }

  // Same-model prompt A/B.
  if (summary.length === 2) {
    const [a, b] = summary;
    const near = Math.abs(a.totalCostUsd - b.totalCostUsd) / Math.max(a.totalCostUsd, b.totalCostUsd, 1e-9) < 0.05;
    if (a.passRate === b.passRate)
      return `A tie on quality (${a.passRate}%) ${near ? "at ~the same cost" : `at close cost ($${a.totalCostUsd} vs $${b.totalCostUsd})`} — ` +
        `no measurable quality difference between the prompts on this set.`;
    const better = a.passRate > b.passRate ? a : b, worse = better === a ? b : a;
    return `Same model — the prompt is the only config that changed, and the pass-rate went from ` +
      `${worse.passRate}% to ${better.passRate}% ${near ? "at ~the same cost" : "at close cost"} ` +
      `($${a.totalCostUsd} vs $${b.totalCostUsd}). This is what prompt versioning + evals are meant to catch: ` +
      `a quality change you can prove with a number.`;
  }
  // Iteration (3+ same-model versions): report the progression and the lesson.
  const prog = summary.map((s) => `${s.label} ${s.passRate}%`).join("  →  ");
  const moved = rates[rates.length - 1] > rates[rates.length - 2];
  return `Progression: ${prog}. ` + (moved
    ? "The last version moved the number, so the change is real and measured."
    : "The last version didn't move the aggregate — the improvement it targets has no eval measuring it yet. " +
      "Add a dedicated case, or it doesn't exist as far as the system is concerned.");
}

// Which scenarios to run: all three by default (mock dashboard), or a single one when SCENARIO is set
// or when recording/replaying (record/replay have fixtures for `prompts` only — running all would
// throw on a fixture miss for models/iterations).
function scenarioKeys(): string[] {
  const only = process.env.SCENARIO;
  const runAll = !only && !RECORD && !REPLAY;
  return runAll ? Object.keys(SCENARIOS) : [only ?? "prompts"];
}

async function main() {
  const keys = scenarioKeys();
  const displayMode = REPLAY ? "replay" : MODE;
  const scenarios: ScenarioPayload[] = [];

  for (const key of keys) {
    const payload = await runScenario(key);
    scenarios.push(payload);
    console.log(`\n⚔️  EVAL ARENA  (${displayMode}) — ${payload.scenarioLabel}`);
    console.log("─".repeat(64));
    for (const s of payload.summary)
      console.log(`${s.label.padEnd(16)} pass ${String(s.passRate).padStart(3)}%  avg ${s.avgLatencyMs}ms  cost $${s.totalCostUsd}`);
    console.log("─".repeat(64));
    console.log("Verdict:", payload.verdict);
  }

  if (RECORD) { saveFixtures(); console.log("\n(recorded live transcripts → evals/fixtures/transcripts.json)"); }

  const combined = {
    dataset: "customer-support-golden-v1",
    mode: displayMode,
    generatedAt: new Date().toISOString(),
    scenarios,
  };
  writeFileSync(join(__dir, "..", "arena-results.json"), JSON.stringify(combined, null, 2));
  const tpl = readFileSync(join(__dir, "..", "web", "dashboard.template.html"), "utf8");
  // Escape "<" so a "</script>" inside the data can't break out of the inline <script>, and use a
  // function replacer so "$" sequences in the JSON aren't interpreted as replacement patterns.
  const dataLiteral = JSON.stringify(combined).replace(/</g, "\\u003c");
  writeFileSync(join(__dir, "..", "web", "dashboard.html"), tpl.replace("/*__ARENA_DATA__*/null", () => dataLiteral));
  console.log(`\n→ web/dashboard.html + arena-results.json written (${scenarios.length} scenario${scenarios.length > 1 ? "s" : ""}).`);

  // ── CI GATE ──  This is what turns "runs evals" into "gates on them": if ANY scenario's best
  // pass-rate drops below the threshold — exit 1 breaks the build.
  const GATE = Number(process.env.ARENA_GATE ?? 80);
  const failing = scenarios.filter((s) => Math.max(...s.summary.map((r) => r.passRate)) < GATE);
  if (failing.length) {
    for (const s of failing)
      console.error(`\n❌ Arena gate FAILED: "${s.scenarioLabel}" best pass-rate ${Math.max(...s.summary.map((r) => r.passRate))}% < required ${GATE}%`);
    process.exit(1);
  }
  console.log(`\n✅ Arena gate passed: every scenario's best pass-rate ≥ ${GATE}%`);
}

// Only run the file-writing / console / CI-gate pipeline when invoked directly
// (npx tsx evals/arena.ts). On import (e.g. from tests) this stays dormant so
// runScenario() can be called without side effects.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
