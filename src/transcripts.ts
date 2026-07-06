// src/transcripts.ts — record/replay store for real model transcripts (VCR/cassette style).
//
// Why: in mock mode the Arena's prompt-vs-prompt delta is *injected* via a MockProfile, so the
// headline number is a stand-in, not a measured result. Recording the real model's responses once
// and replaying them deterministically makes the eval reflect genuine model behavior — reproducibly,
// offline, and for free in CI. The keys are content hashes of the request, so replay reconstructs the
// exact agent loop that was recorded.
//
// Modes (set by the arena:record / arena:replay npm scripts, never in normal server/agent/test use):
//   RECORD=1  → run live and capture every completion + judge verdict into the fixtures file.
//   REPLAY=1  → serve every completion + judge verdict from the fixtures file; no API calls.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const RECORD = process.env.RECORD === "1";
export const REPLAY = process.env.REPLAY === "1";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "evals", "fixtures", "transcripts.json");

type Kind = "completions" | "judgments";
type Store = Record<Kind, Record<string, unknown>>;

let store: Store = { completions: {}, judgments: {} };
let loaded = false;

function load(): void {
  if (loaded) return;
  if (existsSync(FILE)) {
    const parsed = JSON.parse(readFileSync(FILE, "utf8"));
    store = { completions: parsed.completions ?? {}, judgments: parsed.judgments ?? {} };
  }
  loaded = true;
}

// A stable content hash of the request — same request always maps to the same recorded response.
export function fixtureKey(obj: unknown): string {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex").slice(0, 20);
}

export function replayGet<T>(kind: Kind, key: string): T | undefined {
  load();
  return store[kind][key] as T | undefined;
}

export function recordPut(kind: Kind, key: string, value: unknown): void {
  load();
  store[kind][key] = value;
}

export function saveFixtures(): void {
  mkdirSync(dirname(FILE), { recursive: true });
  // Sort keys so the committed file has stable, review-friendly diffs.
  const sorted = (o: Record<string, unknown>) =>
    Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  const out = { completions: sorted(store.completions), judgments: sorted(store.judgments) };
  writeFileSync(FILE, JSON.stringify(out, null, 2) + "\n");
}
