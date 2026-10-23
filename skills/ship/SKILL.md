---
name: ship
description: Closed-loop acceptance gate for an app or app change — build → prove by real use (acceptance-verifier) → fix from the repro → re-prove, looping until PASS or provable non-convergence (progress-gated stopping rule, no fixed iteration budget). Use when the user wants to ship/finish/finalize an app change with the full real-use gate, says "ship it", "close the loop", "verify and fix until it works", or wants to walk away while it converges. Also the hard final gate after /lfg (whose ce-test-browser step is lighter than this bar), and the standalone loop for non-git/scratch projects where /lfg's PR+CI half does not apply.
---

# ship — closed-loop acceptance gate

The loop that lets you ship WITHOUT reading the code: you read the verifier's ship-report, not the source. Green tests are never the gate — a fresh verifier driving the real app is.

## When to use vs /lfg

- **Full hands-off feature pipeline on a real git repo with GitHub CI** (plan → work → review → PR → CI-green): use `/lfg`, then run `/ship` as its final gate. `/lfg`'s `ce-test-browser` step is diff-scoped and lighter than this bar, so `acceptance-verifier` stays the real gate.
- **Just close the loop on a change**, or **non-git/scratch project** where `/lfg`'s commit/push/PR/CI half can't run: use `/ship` directly.

## The loop

1. **Fresh build, target env.** Rebuild (never a stale `dist/`) or run source via `tsx`. Launch in the TARGET env (container/deploy if the app has one, not just local unless it's local-only). Confirm clean startup — no port conflicts, no error spew, expected boot signal. **Build ownership: the dispatcher (you) owns build/redeploy — every iteration, before every verifier. The verifier only CONFIRMS freshness and FAILs if stale; it never rebuilds.**
2. **Prove by real use.** Dispatch the `acceptance-verifier` subagent (`Agent`, `subagent_type: "acceptance-verifier"`) with a CLEAN context. Clean context ≠ empty briefing — front-load the dispatch payload so no verifier tokens burn on re-orientation: repo absolute path, launch command, target env (container/deploy/local), creds/env-file location, what changed this session; if the project's CLAUDE.md carries a `/ship` payload/rubric section, include it verbatim — a domain output-quality rubric there makes quality misses (bad data, garbage presentation) first-class FAIL defects, same as crashes; on re-verify also the prior `REPORT-<n>.md` so the fresh verifier re-tests the fixed defects by name ON TOP OF the full sweep (the payload informs it; it still judges independently). It drives the real app as a fleet of expert humans, watches console+network for silent failures, and RETURNS a structured PASS/FAIL ship-report (evidence + per-defect repro + suggested fix). YOU (the dispatcher) then write that returned report to `<repo>/.acceptance/REPORT.md` — subagents cannot reliably persist files in this harness, so the parent owns the artifact. **Hang guard:** if the verifier stays silent well past the app's normal flow time (wedged app, dead stream), stop its task, kill orphaned app procs, and record the pass as FAIL with defect "app wedged under real use" + whatever evidence exists — a hung verifier is a verdict, not a wait.
3. **Branch on the verdict.**
   - **PASS** → surface the ship-report path. Done = proven. Stop.
   - **FAIL** → step 4.
4. **Fix from the repro — never touch the verifier.** Route the COMPLETE verifier feedback to the fixer (Claude Code) every iteration — repro, root cause, `path:line`, expected vs actual, console/network evidence, and the suggested fix — everything needed to fix in-line. Never drop or summarize detail away; an under-specified handoff is what breaks the loop. The fixer repairs the real root cause in the actual code (this is in-line real-use fixing, NOT writing failing tests / NOT TDD). NEVER weaken, mock, skip, or disable to go green — that manufactures false confidence and locks the defect in.
   - **4b. Ledger the failure (the compounding step).** Archive each FAIL verdict as `<repo>/.acceptance/REPORT-<n>.md` (n = iteration; never overwrite) and append a root-cause entry to `<repo>/docs/solutions/` so the mistake class never repeats and prompt-time retrieval can inject it in future sessions. The `REPORT-<n>` trail doubles as the loop's progress state — the stopping rule in step 6 reads it.
5. **Re-prove with a FRESH verifier.** Rebuild, then dispatch a NEW `acceptance-verifier` (clean context). Never let the context that "fixed" it also bless it — that is the shared-blind-spot trap.
6. **Loop 3→5 with a progress-gated stopping rule — no fixed iteration budget.** The loop runs as long as it is measurably converging and stops the moment it provably isn't. After every FAIL, fingerprint each defect (flow + symptom class + suspected `path:line`; judge identity fuzzily — renames don't reset the clock) and compare against the archived `REPORT-<n>.md` trail:
   - **CONVERGING** — open-defect set strictly shrank AND nothing previously-fixed reappeared → keep looping. No cap.
   - **STALLED** — the same defect survived 2 consecutive fix attempts → one escalation iteration: stop patching, run a full root-cause pass on that defect (debug-mantra → diagnose; re-read every file in the fail path), then fix + re-verify. Still alive after escalation → STOP.
   - **THRASHING** — a previously-fixed defect reappeared, or the open count hasn't dropped in 2 consecutive passes → STOP immediately; fixes are trading bugs, more iterations make it worse.
   - **GAP-ONLY** — the FAIL consists solely of unverifiable gaps (missing creds, unreachable env, tool can't reach target), zero code defects → STOP immediately and surface; not fixable by code, needs the user. Never burn verify passes on it.
   - **Fuse** — hard ceiling of 10 iterations as a runaway guard only, never a working budget; hitting it means the progress rules above failed — treat that as a bug in the loop, not in the app.
   On any STOP short of PASS: surface the full `REPORT-<n>` trail + open defects + which rule fired, and do NOT claim done.

## Rules

- The **verifier declares done, never the builder.** Keep build and verify in separate contexts.
- **Real output correct (values), not shape.** "No error" and "element exists" are not pass conditions.
- Honor every `~/.claude/CLAUDE.md` § Acceptance gate mandate: every element fires its function, tooltips present + unobtrusive, graceful exception handling on every throwable path, the agent conversation stream tested the way THAT project uses it, every seam (UI ↔ API ↔ agent ↔ DB ↔ external) round-trips real messages, console+network clean, clean exit (no orphan procs/ports).
- `.acceptance/` is COMMITTED by default — the `REPORT-<n>` trail is the project's audit ledger and the loop's progress state; gitignore it only on scratch/throwaway projects.
- The Stop hook `~/.claude/verify-gate.sh` is the floor; this skill is how you clear it. When a verifier was dispatched, the gate requires a literal `VERDICT: PASS` on record — a FAIL pass no longer clears it. The inner-loop hook `~/.claude/inner-loop-check.sh` keeps each edit compiling so the loop is not wasted on trivial breakage.
- Audit trail, known-open gaps (verify-gate weaknesses), and the full rationale for the progress-gated stopping rule: `~/.claude/skills/ship/docs/FINDINGS.md`.

## Running on Claude, Codex and ChatGPT

The loop itself is tool-neutral. Two pieces are Claude Code features, and each has a stand-in elsewhere:

| Piece | Claude Code | Codex / ChatGPT |
| --- | --- | --- |
| Fresh verifier | `Agent` tool with `subagent_type: "acceptance-verifier"` (a custom agent in `~/.claude/agents/`) | Start a **separate** session for each verify pass, for example `codex exec "<verifier brief>"` from the repo root, and save its reply as `.acceptance/REPORT.md`. Never verify in the session that wrote the fix. |
| Stop gate | Hooks `verify-gate.sh` (Stop) and `inner-loop-check.sh` (PostToolUse) in `~/.claude/settings.json` | No hooks. Treat the literal `VERDICT: PASS` line in the newest `.acceptance/REPORT-<n>.md` as the gate, and run the build or typecheck yourself after each edit. |

`/lfg` and `ce-test-browser` are separate Claude Code skills. If you don't have them, use `ship` on its own.
