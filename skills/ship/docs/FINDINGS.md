# /ship audit findings — 2026-07-06

Audit of `~/.claude/skills/ship/SKILL.md`, `~/.claude/agents/acceptance-verifier.md`, `~/.claude/verify-gate.sh`, and hook registration in `~/.claude/settings.json`. Status per finding: APPLIED (edited into the skill) or OPEN (documented, not yet applied).

## Baseline: what was already right

- Loop structure (build → verify → fix-from-repro → fresh re-verify) sound.
- Fresh-verifier-per-pass rule kills the shared-blind-spot trap correctly.
- Fixer-ready feedback contract (complete repro, `path:line`, expected vs actual, no summarizing away) correct.
- Hooks registered: Stop → `verify-gate.sh`, PostToolUse → `inner-loop-check.sh` (`~/.claude/settings.json`).
- `acceptance-verifier` pinned to `model: opus` per the model-tier rule.

## Findings

### 1. No mistake ledger — "never repeat mistakes" was unwired — APPLIED
Each iteration overwrote `<repo>/.acceptance/REPORT.md`; the FAIL trail (root causes) evaporated. Nothing wrote to `docs/solutions/`, so the same defect class recurred across projects and prompt-time retrieval had nothing to inject.
**Fix (step 4b):** archive every FAIL as `.acceptance/REPORT-<n>.md` (never overwrite) + append root-cause entry to `<repo>/docs/solutions/`. The archive doubles as the loop's progress state (see finding 7).

### 2. Dispatch payload underspecified — APPLIED
"Clean context" was read as "empty briefing": each Opus verifier burned tokens re-orienting (find launch command, guess env, hunt creds) or tested the wrong env.
**Fix (step 2):** mandatory payload — repo abs path, launch command, target env, creds/env-file location, what changed; on re-verify the prior `REPORT-<n>.md` so fixed defects are re-tested by name on top of the full sweep. Payload informs; verifier still judges independently.

### 3. Unfixable gaps burned the budget — APPLIED
Verifier "Gaps" (missing creds, unreachable env) = FAIL-to-prove, but the fixer cannot code away a missing credential; loop spun full Opus passes on the same gap.
**Fix (step 6 GAP-ONLY):** gap-only FAIL → immediate STOP, surface to user.

### 4. `verify-gate.sh` passes on *attempted* verification, not PASS — APPLIED 2026-07-18
Was: grep counted any tool input containing `verif|acceptance|playwright|...`; a FAIL verify pass (or junk match from an Edit whose content contains "verify") cleared the gate.
**Fix applied:** when an acceptance-verifier dispatch is present, the gate requires `VERDICT: PASS` (markdown-bold tolerated) in transcript tool_results — FAIL/unreturned → block with a verifier-specific message that also names the legitimate stop-short-of-PASS path (stopping rule + REPORT trail, no "done" claim). The generic evidence grep is now scoped to execution-ish tools (Bash/Agent/Task/Skill/mcp__*) so file-edit contents can't fake a match. Fail-open + loop guard preserved. Proven against 11 synthetic transcript cases (PASS/FAIL/floor/junk/docs-only/loop-guard/fail-open) 2026-07-18.

### 5. Subagent-edit blind spot in the gate — APPLIED 2026-07-18 (mitigation)
Was: gate detected code edits only in the MAIN transcript; subagent-driven dev never tripped it.
**Mitigation applied:** `Agent`/`Task` dispatches (excluding acceptance-verifier dispatches) whose prompt/description matches `\b(implement|fix|build|edit|refactor|patch|repair|rewrite)\b` now count as the "code changed" signal. Full fix still needs subagent transcript access, which the hook doesn't have — mitigation can under/over-trigger on wording; loop guard caps cost at one nudge.

### 6. Minor — APPLIED 2026-07-18
- Build ownership: SKILL.md step 1 + acceptance-verifier.md step 2 now state it — dispatcher owns build/redeploy; verifier only confirms freshness and FAILs with a freshness defect if stale (never rebuilds).
- Hang guard: SKILL.md step 2 — verifier silent well past normal flow time → stop its task, kill orphaned app procs, record FAIL "app wedged under real use".
- `.acceptance/` policy: SKILL.md Rules — committed by default (REPORT trail = audit ledger + loop progress state); gitignore only on scratch/throwaway projects.

### 8. Project payload convention — APPLIED 2026-07-18
SKILL.md step 2: if the project's CLAUDE.md carries a `/ship` payload/rubric section, include it verbatim in the dispatch — a domain output-quality rubric there makes quality misses (bad data, garbage presentation) first-class FAIL defects. First instance: a lead-generation project's CLAUDE.md (lead-quality rubric).

### 7. Fixed iteration budget replaced with progress-gated stopping — APPLIED

**Question:** can the loop iterate until correct without a hardcoded budget, and stop itself when it *should* stop? **Yes — feasible, and strictly better than a count.**

**Why it's feasible here:** the verifier's output contract is structured (defect list with flow, symptom, `path:line`) and finding 1 archives every report. That gives the dispatcher a measurable progress signal between iterations — which is the only prerequisite for a convergence-based stopping rule. This is a standard control-loop stall detector; the only fuzzy part is defect-identity matching across reports, and an LLM dispatcher handles fuzzy identity fine (fingerprint = flow + symptom class + suspected path; renames don't reset the clock).

**Why a fixed N is wrong in both directions:**
- Too low → kills runs that are genuinely converging (defect count dropping every pass) one iteration before PASS.
- Too high → burns full-Opus verify passes on a run that is provably diverging (same defect surviving, or fixes trading bugs).
- Any single N is both, depending on the app. The information needed to stop is in the report trail, not in a constant.

**The rule (now step 6 of the loop):**

| State | Signal (vs `REPORT-<n>` trail) | Action |
|---|---|---|
| CONVERGING | Open set strictly shrank, nothing fixed reappeared | Continue — no cap |
| STALLED | Same defect survived 2 consecutive fix attempts | One escalation pass: root-cause analysis (debug-mantra → diagnose) instead of another patch; still alive → STOP |
| THRASHING | Previously-fixed defect reappeared, or count flat/up 2 passes | STOP immediately — fixes are trading bugs |
| GAP-ONLY | Only unverifiable gaps, zero code defects | STOP immediately — needs user, not code |
| Fuse | 10 iterations | Runaway guard only; hitting it = bug in the loop, not the app |

**Properties:** cost self-regulates — convergent runs pay exactly what convergence needs (may legitimately exceed the old default of 3); divergent runs stop in ~3-4 instead of grinding to an arbitrary cap. The escalation pass encodes "stop patching, start diagnosing" — the single highest-value response to a stall. THRASHING is the regression-loop detector: it is the machine version of "never trade one bug for a new one."

## Best way to use /ship

- **Invoke** after any app change ("ship it"), standalone on scratch/non-git projects, and always as the final gate after `/lfg` (its `ce-test-browser` step is lighter than this bar).
- **Front-load the dispatch** (biggest lever for shortest iterations): launch command, target env, creds location, what changed — in the same message as `/ship`.
- **Pre-stage the repo:** working launch line (`package.json` script / compose file / project `run` skill) so the verifier orients in seconds; fresh graphify graph helps the fixer side.
- **Batch changes, ship once** — each verify pass is a full Opus agent; don't `/ship` per micro-edit.
- **Walk away:** the loop is autonomous and now self-terminating on non-convergence. Read `<repo>/.acceptance/REPORT.md` (+ the `REPORT-<n>` trail on failures) when back — never the code.
- **Don't** pre-bless with builder-side manual testing and skip the verifier (shared-blind-spot trap), and don't scope the verifier to "just the changed screen" — whole-app is the contract.
