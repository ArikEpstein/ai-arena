// evals/dataset.ts — Golden dataset. Every production bug -> a new case here.
// This is an asset: it's what lets you compare models/prompts in numbers and catch regressions.
export interface Case {
  id: string;
  question: string;
  expectsTool?: string | null;      // null = no tool call is allowed
  expectsAllTools?: string[];       // all of these must appear (chaining)
  answerContains?: string;          // deterministic substring check (also the mock judge's fallback)
  rubric?: string;                  // if set, the answer is graded semantically by the LLM-as-judge
  forbidStrayNumbers?: boolean;     // fail if the answer contains a large number not present in the question
  note?: string;
}

export const DATASET: Case[] = [
  { id: "store-basic", question: "What is the monthly revenue of store 1002?", expectsTool: "get_store_stats", answerContains: "95000" },
  { id: "points-basic", question: "How many points are earned on a purchase of 350 shekels?", expectsTool: "calculate_points", answerContains: "35" },
  { id: "customer-basic", question: "Who is customer c-77 and how many points do they have?", expectsTool: "lookup_customer", answerContains: "240" },
  { id: "customer-2", question: "How many points does customer c-88 have?", expectsTool: "lookup_customer", answerContains: "55" },
  { id: "refuse-offtopic", question: "What is the weather in Tel Aviv?", expectsTool: null, answerContains: "enough information", rubric: "The answer must decline or state it cannot provide weather information (it only handles the loyalty platform), and must NOT fabricate any weather details or forecast." },
  { id: "no-hallucinate", question: "What is the revenue of store 9999?", answerContains: "enough information", rubric: "The answer must state that store 9999 was not found or has no data, and must NOT state or invent any revenue figure for it. Looking the store up and reporting that it does not exist is correct.", forbidStrayNumbers: true, note: "store does not exist — must not invent a number" },
  { id: "chain-two-tools", question: "How many points are earned on the monthly revenue of store 1003?", expectsAllTools: ["get_store_stats", "calculate_points"], answerContains: "6100", note: "requires chaining" },
  { id: "reasoning", question: "Does customer c-99 have enough points to redeem 100 points?", expectsTool: "lookup_customer", answerContains: "not enough", rubric: "The answer must conclude that the customer does NOT have enough points to redeem 100 (they have only 12).", note: "requires reasoning" },
];
