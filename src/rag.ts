// src/rag.ts — full two-stage RAG: chunk -> embed -> retrieve -> rerank -> ground.
import { chunk } from "./chunking.js";
import { VectorStore } from "./vectorStore.js";
import { rerank } from "./rerank.js";
import { MODE, MODELS } from "./config.js";

// "Long" documents (in production: real support/policy docs). Split into chunks automatically.
const DOCS: Record<string, string> = {
  "policy/shipping": `Shipping policy. We ship to Israel, the US, and Europe.
    We currently do not ship to Australia or New Zealand. Standard shipping takes 3-5 business days.
    Express shipping takes 1-2 business days. Loyalty members get free express shipping over 200 shekels.`,
  "policy/returns": `Returns policy. You may return an item within 30 days of delivery for a full refund,
    provided it is unused and in its original packaging. An item that arrives broken or defective can be reported
    within 7 days for a free replacement or a full credit.`,
};

let store: VectorStore | undefined;

export async function initRag() {
  store = new VectorStore();
  for (const [source, text] of Object.entries(DOCS)) {
    await store.addChunks(chunk(source, text, { max: 220, overlap: 40 }));
  }
}

export interface RagResult {
  answer: string;
  sources: { text: string; source: string; score: number }[];
  simulated: boolean;
}

export async function answerWithRag(question: string): Promise<RagResult> {
  if (!store) throw new Error("call initRag() before answerWithRag()");
  // Stage 1: broad vector retrieval (fast, recall)
  const retrieved = await store.search(question, 6);
  // Stage 2: precise reranking (precision) -> top 3
  const top = await rerank(question, retrieved, 3);
  const context = top.map((h) => `[${h.meta.source}] ${h.text}`).join("\n");
  const sources = top.map((h) => ({ text: h.text, source: h.meta.source, score: Number(h.score.toFixed(3)) }));

  if (MODE === "live") {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();
    const res = await client.messages.create({
      model: MODELS.work,
      max_tokens: 400,
      system: [
        // Cache the stable instruction prefix, not the per-query context (which changes every request
        // and would never be read back). Below the model's minimum cacheable prefix this is inert — it
        // demonstrates correct breakpoint placement for when the fixed instructions are large.
        { type: "text", text: "Answer using only the context. If the answer is not in the context, say you don't know. Cite the source.", cache_control: { type: "ephemeral" } },
        { type: "text", text: context },
      ] as any,
      messages: [{ role: "user", content: question }],
    });
    const answer = (res.content.find((b: any) => b.type === "text") as any)?.text ?? "";
    return { answer, sources, simulated: false };
  }

  // mock: show the retrieved context (no model to phrase it). Demonstrates retrieval + rerank.
  return {
    answer: `(mock) Based on the retrieved context: ${top[0]?.text ?? "not found"}`,
    sources,
    simulated: true,
  };
}
