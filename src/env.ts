// src/env.ts — load .env into process.env before anything reads it.
// Imported first by config.ts so both MODE and the Anthropic/Voyage SDKs see the values.
// Node >=20.12 provides process.loadEnvFile(); it throws when .env is absent (mock/CI), so we
// ignore that. Existing environment variables are NOT overridden — so `LLM_MODE=mock npm test`
// (and the mock Arena/CI scripts) stay mock even when .env sets LLM_MODE=live.
try {
  process.loadEnvFile();
} catch (e) {
  // A missing .env is fine — run on the ambient environment (mock by default). But a malformed
  // or unreadable .env should not be swallowed silently, or the developer gets confusing mock behavior.
  if ((e as NodeJS.ErrnoException).code !== "ENOENT")
    console.warn(`[env] could not load .env: ${String(e)}`);
}
