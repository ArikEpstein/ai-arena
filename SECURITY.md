# Security Policy

## Scope

**AI Arena is a portfolio/demo project, not a production service.** It ships in mock mode with no
API keys, and intentionally has **no authentication, rate limiting, or PII handling** — see the
[production migration path](./ARCHITECTURE.md#9-production-migration-path) for what a real deployment
would add. Please do **not** report "the endpoints have no auth / no rate limit" as a vulnerability;
that is a documented, intentional property of the demo.

## Reporting a vulnerability

For a genuine issue (a leaked secret, a dependency CVE affecting the demo, or a code-execution / SSRF
bug in the app logic), please report it privately:

- **GitHub → Security → Report a vulnerability** (private advisory), or
- email **arik.epstein@gmail.com**

Please include reproduction steps and the affected file/commit. I aim to acknowledge within a few days.

## Supported versions

Only the `main` branch is maintained.
