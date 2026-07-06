// src/chunking.ts — real chunking. RAG quality is decided here, not in the model.
// Strategy: recursive splitting along natural boundaries (paragraph -> sentence), with overlap
// that prevents cutting an idea in half. Each chunk carries metadata for citation.

export interface Chunk { text: string; meta: { source: string; index: number }; }

const SEPARATORS = ["\n\n", "\n", ". ", "! ", "? ", " "];

function splitRecursive(text: string, max: number, seps: string[]): string[] {
  if (text.length <= max) return [text];
  const [sep, ...rest] = seps;
  if (sep === undefined) {
    // No separators left — hard cut
    const out: string[] = [];
    for (let i = 0; i < text.length; i += max) out.push(text.slice(i, i + max));
    return out;
  }
  const parts = text.split(sep);
  const out: string[] = [];
  let buf = "";
  for (const p of parts) {
    const candidate = buf ? buf + sep + p : p;
    if (candidate.length <= max) buf = candidate;
    else {
      if (buf) { out.push(buf); buf = ""; } // flush and reset — otherwise buffered text is re-emitted
      if (p.length > max) out.push(...splitRecursive(p, max, rest));
      else buf = p;
    }
  }
  if (buf) out.push(buf);
  return out;
}

export function chunk(source: string, text: string, { max = 400, overlap = 60 } = {}): Chunk[] {
  const base = splitRecursive(text.trim(), max, SEPARATORS).filter((s) => s.trim());
  // Add overlap: each chunk drags in a tail of the previous one, so context isn't lost at the boundary
  const chunks: Chunk[] = [];
  for (let i = 0; i < base.length; i++) {
    // Guard overlap === 0: slice(-0) === slice(0) would drag in the entire previous chunk.
    const prevTail = i > 0 && overlap > 0 ? base[i - 1].slice(-overlap) : "";
    const chunkText = (prevTail ? prevTail + " " : "") + base[i];
    chunks.push({ text: chunkText.trim(), meta: { source, index: i } });
  }
  return chunks;
}
