// evals/graders.ts — the deterministic scoring logic, kept separate so it is unit-testable.
// A pure grader: takes a case + output (answer+trace) -> pass/fail + reasons. It covers the
// structured expectations (tool trace, exact values). Open-ended answers (cases with a `rubric`)
// are graded semantically by the LLM-as-judge in ./judge.ts instead of by substring here.
import type { Case } from "./dataset.js";

export interface Gradable { answer: string; trace: { tool: string }[]; }

// Substring match with number normalization: strip thousands separators so a real model's "95,000"
// satisfies "95000", and require a digit boundary so "35" does not falsely match inside "350".
export function answerMatches(answer: string, needle: string): boolean {
  if (/^\d+$/.test(needle)) {
    const hay = answer.replace(/(?<=\d),(?=\d)/g, "");
    return new RegExp(`(?<!\\d)${needle}(?!\\d)`).test(hay);
  }
  return answer.includes(needle);
}

export function grade(c: Case, r: Gradable): { pass: boolean; reasons: string[] } {
  const tools = r.trace.map((t) => t.tool);
  const reasons: string[] = [];
  if (c.expectsTool === null && tools.length) reasons.push(`called an unnecessary tool: ${tools.join(",")}`);
  if (typeof c.expectsTool === "string" && !tools.includes(c.expectsTool)) reasons.push(`missing tool '${c.expectsTool}'`);
  for (const need of c.expectsAllTools ?? []) if (!tools.includes(need)) reasons.push(`missing from chain '${need}'`);
  // Skip the substring answer check when a rubric is present — the LLM-judge grades that answer.
  if (c.answerContains && !c.rubric && !answerMatches(r.answer, c.answerContains))
    reasons.push(`missing from answer '${c.answerContains}'`);
  // Hallucination backstop: strip every number quoted from the question (even inside a longer run),
  // then flag a stray 4+ digit number that is not a plausible year — a sign the model invented a figure.
  if (c.forbidStrayNumbers) {
    let stripped = r.answer;
    for (const n of c.question.match(/\d{4,}/g) ?? [])
      stripped = stripped.replace(new RegExp(`\\d*${n}\\d*`, "g"), "");
    if (/\b(?!(?:19|20)\d{2}\b)\d{4,}\b/.test(stripped)) reasons.push("possibly an invented number");
  }
  return { pass: reasons.length === 0, reasons };
}
