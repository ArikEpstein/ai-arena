// src/rerank.ts — the second stage of two-stage RAG (bi-encoder retrieve -> cross-encoder rerank).
// Retrieval returns a roughly-right topK; the reranker reads query+chunk together and reorders with
// higher precision. A standard production pattern.
import { RERANK_MODEL } from "./config.js";
import type { Hit } from "./vectorStore.js";

async function voyageRerank(query: string, hits: Hit[], topN: number): Promise<Hit[]> {
  const res = await fetch("https://api.voyageai.com/v1/rerank", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.VOYAGE_API_KEY}` },
    body: JSON.stringify({ model: RERANK_MODEL, query, documents: hits.map((h) => h.text), top_k: topN }),
    signal: AbortSignal.timeout(15_000), // don't let a hung upstream stall the request
  });
  if (!res.ok) throw new Error(`Voyage rerank ${res.status}: ${await res.text()}`);
  // Voyage returns the ranking under `data` (not `results`): { data: [{ index, relevance_score }], ... }
  const body = (await res.json()) as { data: { index: number; relevance_score: number }[] };
  return body.data.map((r) => ({ ...hits[r.index], score: r.relevance_score }));
}

// Fallback: no reranker without a key — return the existing order (identity).
export async function rerank(query: string, hits: Hit[], topN = 3): Promise<Hit[]> {
  if (process.env.VOYAGE_API_KEY) {
    try { return await voyageRerank(query, hits, topN); }
    catch (e) { console.warn(`[rerank] Voyage rerank failed, falling back to identity order: ${String(e)}`); }
  }
  return hits.slice(0, topN);
}
