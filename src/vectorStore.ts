// src/vectorStore.ts — a minimal in-memory vector DB (cosine).
// This is what pgvector/Pinecone do. Moving to pgvector = swapping add/search
// for SQL queries with the <=> operator; the rest of the pipeline is unchanged — hence the clean interface.
import { embed } from "./embeddings.js";
import type { Chunk } from "./chunking.js";

function cosine(a: number[], b: number[]): number {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

export interface Hit extends Chunk { score: number; }

export class VectorStore {
  private items: (Chunk & { vector: number[] })[] = [];

  async addChunks(chunks: Chunk[]): Promise<void> {
    const vectors = await embed(chunks.map((c) => c.text), "document");
    if (vectors.length !== chunks.length)
      throw new Error(`embed returned ${vectors.length} vectors for ${chunks.length} chunks`);
    chunks.forEach((c, i) => this.items.push({ ...c, vector: vectors[i] }));
  }

  async search(query: string, topK = 5): Promise<Hit[]> {
    const [q] = await embed([query], "query");
    return this.items
      .map((it) => ({ text: it.text, meta: it.meta, score: cosine(q, it.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  get size(): number { return this.items.length; }
}
