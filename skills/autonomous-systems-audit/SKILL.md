---
name: autonomous-systems-audit
description: "Read-only architectural and runtime audit of the CC-MAESTRO self-driving agent harness, hermetic test suite, Graphify knowledge graph, wiki, and durable memory stores. Use when the user asks for an autonomous systems audit, harness health audit, CC-MAESTRO audit, graphify/wiki/memory drift check, or '/autonomous-systems-audit'."
---

# Autonomous Systems Audit (`autonomous-systems-audit`)

100% read-only architectural and operational health audit of the CC-MAESTRO self-driving harness (`/home/chris2/dev/CC-MAESTRO`), global agent hooks (`/home/chris2/.claude`), and durable memory stores. Every finding is backed by evidence, and the audit ends with a supervisor handoff proposal.

## Cognitive Frame & Operating Posture

Audit as the principal engineer who owns the proof that the harness works:
1. **100% Read-Only Mandate:** Never edit, write, delete, commit, stash, restart, or send keys to any repository file, `/home/chris2/dev/CC-MAESTRO/state/` file, systemd unit, or Herdr pane.
2. **Systems-First Ground Truth:** Never trust prose claims in docs or evidence files without checking live code, live state logs, and running the bundled read-only telemetry probe first.
3. **Full Absolute Paths & Line Citations:** Cite every file using full `/home/chris2/...` paths and exact 1-indexed line numbers (`file:///home/chris2/...#L...`). Verify every proposed diff against the actual lines on disk before emitting it.

---

## Ordered Audit Workflow

### Step 1: Run the Deterministic Read-Only Telemetry Probe First

Before reading source files, run the bundled probe script to collect exact, ground-truth numbers across Track A and Track B:

```bash
python3 /home/chris2/.agents/skills/autonomous-systems-audit/scripts/audit_probe.py /home/chris2/dev/CC-MAESTRO
```

Read the JSON output carefully:
- `runtime.clean_day_no_tests`: Fast check of today's `state/relaunch/*.log` files (`CLEAN` vs. `NOT CLEAN`).
- `runtime.recent_relaunches`: Last 10 relaunch logs (`RESULT:` and `boot_to_drive_s`, bar is `<= 15.0s`).
- `state_hygiene.send_timing`: Total rows vs. leaked synthetic test rows (`test`, `nu8-test`, `fake`, `dummy`).
- `track_b_graphify.graph_nodes`: Total node/edge count in `graphify-out/graph.json`, top source prefixes (`tools/` vs. `reviews/`, `state/`, `raw/`, `archive/`), and `.freshness.json` status (`current`, `docs-pending`, `stale`).
- `track_b_graphify.meter`: Breakdown of `~/.local/state/graphify-context-meter.log` (`session-orientation` status counts, `stale` rows where `code=0, deleted=0`, and `first-search` `bytes=24` no-match waste).
- `track_b_graphify.dead_wiki_refs`: Scan of `~/.claude/hooks/*.sh`, `~/.config/agent-context/INSTRUCTIONS.md`, and `queue/*.md` for dead pre-`PR.3` wiki paths (`wiki/projects`, `wiki/inbox.md`, `wiki/rules/`).
- `track_b_graphify.graphify_version`: Checks `graphify --version` and `graphify --help` for skill version drift warnings across agent skill folders.

### Step 2: Verify Track A — Self-Driving Harness & Test Suite Hermeticity

1. **Run the Hermetic Test Suite Check:**
   Run `clean_day.py` (which since `RA.8` / `Q139` runs `pytest` in `tools/` with `CLEAN_DAY_SKIP_TESTS=1` recursion protection) or run `pytest` directly inside isolated temp directories from `/tmp`:
   ```bash
   TMP_TURN=$(mktemp -d) TMP_QSTATE=$(mktemp -d) TMP_LOCKS=$(mktemp -d) TMP_DEC=$(mktemp -d)
   env PYTHONDONTWRITEBYTECODE=1 CC_TURN_STATE="$TMP_TURN" CC_QUEUE_STATE="$TMP_QSTATE" CC_LOCKS_DIR="$TMP_LOCKS" DECISIONS_STATE="$TMP_DEC" \
     python3 -m pytest -p no:cacheprovider /home/chris2/dev/CC-MAESTRO/tools -W error::pytest.PytestUnhandledThreadExceptionWarning -q --tb=short
   rm -rf "$TMP_TURN" "$TMP_QSTATE" "$TMP_LOCKS" "$TMP_DEC"
   ```
2. **If Any Test Fails, classify the root cause by re-running the failing file alone:**
   - **Passes alone, fails in suite (Cross-Test Global Pollution):** Check for un-restored module-level or `setUp` assignments to `fleetd.*`, `turnend.*`, `queue.*`, or `time.sleep` without `mock.patch.object(..., ...)` + `self.addCleanup(p.stop)`.
   - **Fails both ways (Clock / Turn-State Drift):** Check for hardcoded `HH:MM` timestamps vs. `time.time()` or uncleaned `ready-exact`/`ready-by`/`turn-end` files in `CC_TURN_STATE`.
   - **Thread Exception Warning (Temp-File Race):** Check `.tmp` file creation in `tools/atomic.py`, `tools/turnend.py`, and `tools/queue.py` for unique per-writer temp names (`tempfile.mkstemp` or `pid + thread_id`).
3. **Verify `state/` Leak Quarantine:**
   Confirm `wc -l /home/chris2/dev/CC-MAESTRO/state/send-timing.jsonl` and `state/events.jsonl` are identical before and after the test run.

### Step 3: Verify Track B — Graphify, Wiki (`PR.3`), & Durable Memory Architecture

Inspect and cross-reference:
1. **Freshness Pipeline Consistency:** Compare `~/.claude/hooks/graph-gate.sh`, `~/.claude/graph-plan.py`, `~/.claude/graph-refresh.sh`, `queue/loop-prompt.md` (line 4 `STALE GATE`), and `queue/supervisor-loop.md` (step 0). Ensure docs-only changes (`pending.code == 0 and pending.deleted == 0`) write `"docs-pending"` (not `"stale"`) and that workers trust code AST edges when status is `"current"` or `"docs-pending"`.
2. **Graph Corpus Signal-to-Noise:** Check `/home/chris2/dev/CC-MAESTRO/.graphifyignore` and `graphify-out/GRAPH_REPORT.md` to verify `tools/` modules (`fleetd.py`, `queue.py`, `auto-relaunch.py`, `sup_push.py`) dominate the top Community Hubs rather than `state/`, `raw/`, or historical `reviews/` archives.
3. **Hook & Instruction Path Integrity:** Verify `~/.claude/hooks/session-context.sh`, `~/.claude/hooks/first-search-graph.sh` (`--graph "$ROOT/graphify-out/graph.json"` and skipping `"No matching nodes"` before `touch "$SENT"`), `~/.config/agent-context/INSTRUCTIONS.md`, and the graphify semantic-extraction shim (`graphify-agy-bin`). Check the shim itself: `graphify install` and auto-refresh rewrite graphify's SKILL.md, so a note inside that file is not durable.

---

## Required Output Structure

Always structure the final audit report into these 4 sections:
1. **Executive Summary Verdict:**
   - **Production Runtime Verdict (`GREEN / CLEAN` or `RED`)** with today's relaunch latency numbers and `clean_day.py` result.
   - **Test Suite & Memory Architecture Verdict (`GREEN` or `YELLOW / RED`)** with exact pass/fail counts and telemetry ratios.
2. **Track A Findings Table & Exact Code Citations (`A0`–`An`):**
   - For every finding: (1) Verified Evidence (`file:///home/chris2/...#L...` + measured numbers), (2) Root-Cause Mechanism, (3) Impact on Autonomy/Reliability, and (4) Minimal Apply-Clean Unified Diff.
3. **Track B Findings Table & Exact Code/Data Citations (`B1`–`Bn`):**
   - Same 4-part structure backed by `audit_probe.py` metrics.
4. **Ready-to-Paste Prompt for the Opus Supervisor (`w1D:pM`):**
   - Self-contained markdown block that Chris can paste directly into `w1D:pM` asking Opus to verify each finding, state agreement/disagreement, and queue approved fixes to `housekeeping` (`w1F:p1`) with `--done` and `--not` contracts.

## Running on Claude, Codex and ChatGPT

Machine-specific: it audits one CC-MAESTRO checkout and the paths are absolute. Step 1 runs the probe from `~/.agents/skills/`, which is where Codex and the ChatGPT desktop app read skills. Under Claude Code the same probe lives at `~/.claude/skills/autonomous-systems-audit/scripts/audit_probe.py`; run that path instead. Everything else (the read-only rules, the probe, the report shape) is the same on both.
