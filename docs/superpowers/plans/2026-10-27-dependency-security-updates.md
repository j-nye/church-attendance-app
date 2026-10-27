# Dependency Security Updates Plan

**Date:** 2026-10-27
**Baseline:** `main` @ `fa90984` (fast-forwarded from `ff954de`; 77 commits behind origin, none ahead — no rebase needed)
**Trigger:** `npm audit` reports 9 vulnerabilities (1 critical, 5 high, 3 moderate)

## Goal

Clear every open `npm audit` finding with the smallest possible change set, keep CI green, and defer unrelated major-version upgrades to their own PRs.

## Findings

| Package | Locked | Sev | Direct? | Fix | Notes |
|---|---|---|---|---|---|
| `next` | 16.3.4 | **critical** | yes | **16.4.3** | 11 advisories: RCE in `next/og` / Image Optimization (SVG) / `use cache`, SSRF in image optimization, cache poisoning (SSG/ISR), Server Actions DoS. Pinned exactly in `package.json`, so `npm audit fix` will not touch it. |
| `zod` | 4.6.3 | high | yes | ≥ 4.6.6 (4.6.7 latest) | Memory exhaustion on oversized constrained collections. Directly relevant: every server action input goes through Zod. Dependabot PR #36 only reaches 4.6.5 — **not enough**. |
| `vite` | 8.3.1 | high | transitive (vitest) | ≥ 8.3.3 | Dev-server only (file exposure, launch-editor). Not in the production bundle. |
| `sharp` | 0.35.4 | high | transitive (next) | ≥ 0.35.5 | librsvg CVE. Should resolve with the `next` bump; verify. |
| `source-map-js` | 1.2.1 | high | transitive | > 1.2.1 | `npm audit fix` |
| `brace-expansion` | 1.1.18 (+ nested copy under `@typescript-eslint/typescript-estree`) | high | transitive | `npm audit fix` | Stack-exhaustion DoS, build tooling only. |
| `vitest`, `@vitest/coverage-v8`, `@vitest/mocker` | 5.0.1 | moderate | yes | 5.0.2+ | Dependabot PR #33. |

## Out of scope (separate PRs, not security-driven)

These are open Dependabot PRs for majors with no matching advisory. Don't bundle them:

- `prisma` 6 → 7 (#24) — major, touches `prisma.config.ts`, client generation and the `postinstall` hook. Needs its own migration pass. `@prisma/client` must move in lockstep.
- `eslint` 9 → 10 (#35) — major; blocked on `eslint-config-next` supporting it.
- `dotenv` 17 → 18 (#32).
- `next-auth` stays on `5.0.0-beta.32`; `npm outdated` "latest 4.24.15" is the v4 line and must **not** be applied.
- `react` / `react-dom` 19.3.x — no advisory; leave at 19.2.8 unless Next 16.4.3 requires otherwise.

## Steps

Work on a branch `deps/security-2026-10-27` off `main`. Use **npm 10 / Node 22** for every lockfile change (commit `3e26697` fixed CI breakage from a lockfile generated with a different npm).

### 1. Baseline
- `npm ci && npm run lint && npm run test` — confirm green before changing anything.
- `npm run build` — record that it passes on 16.3.4.

### 2. Next.js (the critical one) — own commit
- Bump `next` to `16.4.3` (exact pin, matching current convention) and `eslint-config-next` to the matching version.
- Read `node_modules/next/dist/docs/` for 16.4 notes (per AGENTS.md) — specifically anything touching `proxy.ts` (renamed from middleware), Server Actions, caching, and image config.
- `npm install`, then `npm run lint && npm run test && npm run build`.
- Smoke test locally: sign-in, record a count, view a report, and confirm `revalidatePath` still refreshes the entry and report pages.
- Check `next.config.ts` for `images` / `use cache` usage. The app likely uses neither, which would lower real-world exposure, but upgrade regardless.

### 3. Zod — own commit
- Bump to `^4.6.7` (supersedes Dependabot #36; close it afterwards).
- Run unit tests; the 17 Vitest specs cover the schemas in `src/lib/validation.ts`.
- Consider adding explicit `.max()` bounds on any array/collection fields in the schemas. This is defence in depth for the memory-exhaustion class of bug.

### 4. Test tooling and transitives — one commit
- Bump `vitest` and `@vitest/coverage-v8` to `^5.0.2` (supersedes #33).
- `npm audit fix` (non-force) to pick up `vite`, `sharp`, `source-map-js`, `brace-expansion`.
- Do **not** run `npm audit fix --force`; it would bump `next` outside its pin and may cascade.
- If `brace-expansion` under `@typescript-eslint/typescript-estree` doesn't dedupe, add an `overrides` entry next to the existing `deepmerge-ts` one.

### 5. Verify
- `npm audit` → expect 0 vulnerabilities (or document any residual with justification).
- `npm run lint && npm run test && npm run build`.
- `npm run test:e2e:local` — AGENTS.md requires an e2e run when auth or counts are touched, and a Next bump touches both indirectly.
- `npm run security:sast` (Semgrep).
- Push the branch and confirm CI plus CodeQL are green (branch protection is live).

### 6. Cleanup
- Close superseded Dependabot PRs (#33, #36). Leave #24, #32, #35 open for the follow-up work.
- Merge the GitHub Actions bumps (#39, #41, #42) separately; low-risk, and CodeQL 4.39.0 is worth having.
- Update `docs/superpowers/plans/2026-08-31-deploy-checklist.md` if the deploy steps change.

## Risk and rollback

- **Highest risk:** Next 16.3 → 16.4 behavioural changes in caching or Server Actions. Mitigation: isolated commit, so it can be reverted without losing the Zod and tooling fixes.
- **Lockfile drift:** regenerate only with npm 10 / Node 22.
- **Rollback:** each step is its own commit; revert the offending commit and redeploy the previous Vercel build.

## Done when

- `npm audit` reports 0 vulnerabilities, or each residual is documented.
- Lint, unit, build, e2e and SAST all pass locally and in CI.
- Superseded Dependabot PRs are closed.
