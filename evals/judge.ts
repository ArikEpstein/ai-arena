// evals/judge.ts — LLM-as-judge for open-ended answers.
// Substring grading is brittle for natural language: a real model refuses or concludes correctly
// but phrases it differently than any fixed string. Production evals solve this with a judge model.
//
// Mock/live parity, same as the rest of the app: in mock the judge is a deterministic stand-in
// (it reuses the case's substring expectation, so CI stays free and the pass-rate is reproducible);
// in live it is a real LLM (haiku) scoring the answer against the rubric.
import { MODE, MODELS } from "../src/config.js";
import { answerMatches } from "./graders.js";

export interface Verdict { pass: boolean; reason: string; }

export async function judgeAnswer(
  rubric: string,
  question: string,
  answer: string,
  fallbackContains?: string,
): Promise<Verdict> {
  if (MODE !== "live") {
    // Deterministic stand-in: reuse the substring expectation the mock answers are built around.
    const ok = fallbackContains ? answerMatches(answer, fallbackContains) : true;
    return { pass: ok, reason: ok ? "mock judge: expectation met" : `mock judge: answer did not signal "${fallbackContains}"` };
  }

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const res = await client.messages.create({
    model: MODELS.fast, // haiku — cheap, fast; judging is a simpler task than answering
    max_tokens: 200,
    system:
      "You are a strict evaluator. Decide whether the ANSWER satisfies the RUBRIC for the given QUESTION. " +
      'Reply with ONLY compact JSON: {"pass": true|false, "reason": "<one short sentence>"}.',
    messages: [{ role: "user", content: `RUBRIC: ${rubric}\nQUESTION: ${question}\nANSWER: ${answer}` }],
  });
  const text = (res.content.find((b: any) => b.type === "text") as any)?.text ?? "";
  try {
    const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
    return { pass: !!parsed.pass, reason: String(parsed.reason ?? "no reason given") };
  } catch {
    return { pass: false, reason: "judge returned unparseable output" };
  }
}
