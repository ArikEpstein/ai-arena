// src/server.ts — ties everything together behind HTTP. The same backend any frontend (React/Angular) connects to.
import express from "express";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { stream } from "./llm.js";
import { runAgent } from "./agent.js";
import { initRag, answerWithRag } from "./rag.js";
import { MODELS } from "./config.js";

const app = express();
app.use(express.json());
const webDir = join(dirname(fileURLToPath(import.meta.url)), "..", "web");
app.use(express.static(webDir));

// 1. Streamed chat (SSE) — the consumer in React/Angular is identical
app.get("/api/chat", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  // Validate before flushing SSE headers, so a bad request gets a real 400 (consistent with the other routes).
  if (!q) return res.status(400).json({ error: "query param q must be a non-empty string" });
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  try {
    for await (const t of stream(q)) res.write(`event: text\ndata: ${JSON.stringify({ t })}\n\n`);
    res.write(`event: done\ndata: {}\n\n`);
  } catch (e) {
    // Headers are already flushed, so surface the error as an SSE event rather than an HTTP status.
    console.error("[/api/chat]", e);
    res.write(`event: error\ndata: ${JSON.stringify({ error: String(e) })}\n\n`);
  } finally {
    res.end();
  }
});

// 2. Agent with tools (loop — not streamed)
app.post("/api/agent", async (req, res) => {
  const message = req.body?.message;
  if (typeof message !== "string" || !message.trim())
    return res.status(400).json({ error: "body.message must be a non-empty string" });
  try {
    const r = await runAgent(message, { label: "api", model: MODELS.work });
    res.json({ answer: r.answer, trace: r.trace, usage: r.usage, latencyMs: r.latencyMs });
  } catch (e) { console.error("[/api/agent]", e); res.status(500).json({ error: String(e) }); }
});

// 3. Two-stage RAG
app.post("/api/rag", async (req, res) => {
  const question = req.body?.question;
  if (typeof question !== "string" || !question.trim())
    return res.status(400).json({ error: "body.question must be a non-empty string" });
  try { res.json(await answerWithRag(question)); }
  catch (e) { console.error("[/api/rag]", e); res.status(500).json({ error: String(e) }); }
});

const PORT = Number(process.env.PORT ?? 3000);
await initRag();
app.listen(PORT, () => {
  // The dashboard is a generated artifact — only advertise it once it exists.
  const dash = existsSync(join(webDir, "dashboard.html"))
    ? "  (dashboard: /dashboard.html)"
    : "  (run `npm run arena` to generate the dashboard)";
  console.log(`AI Arena → http://localhost:${PORT}${dash}`);
});
