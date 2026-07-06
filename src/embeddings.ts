// src/embeddings.ts — text -> vector.
// Asymmetric embeddings: input_type "query" vs "document".
// A query and a document are encoded differently, which improves retrieval accuracy. Voyage supports this natively.
// Fallback: a local toy embedder so everything runs without a key.
import { EMBED_MODEL } from "./config.js";

const DIM = 256;
function hashToken(t: string) { let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0; return h % DIM; }
function toyEmbed(text: string): number[] {
  const v = new Array(DIM).fill(0);
  for (const t of text.toLowerCase().match(/[a-z0-9\u0590-\u05FF]+/g) || []) v[hashToken(t)] += 1;
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

export type InputType = "query" | "document";

async function voyageEmbed(texts: string[], inputType: InputType): Promise<number[][]> {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.VOYAGE_API_KEY}` },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts, input_type: inputType, output_dimension: 1024 }),
    signal: AbortSignal.timeout(15_000), // don't let a hung upstream stall the request
  });
  if (!res.ok) throw new Error(`Voyage ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.data.map((d: any) => d.embedding);
}

export async function embed(texts: string[], inputType: InputType): Promise<number[][]> {
  if (process.env.VOYAGE_API_KEY) return voyageEmbed(texts, inputType);
  return texts.map(toyEmbed); // local fallback
}
