# The Conductor improvement loop

Conductor is Retell's agent-design copilot. It is **dashboard-only with zero API**, so the only way
to automate it is a real logged-in browser over CDP. `scripts/conductor.mjs` wraps every quirk.

It is a **strong reviewer and a dangerous editor**. Run it inside this loop, never freehand.

---

## One-time setup

Chrome ≥136 refuses CDP on the default profile, so use a dedicated persistent profile. You log in by
hand **once**; the session persists across launches.

```bash
chrome --user-data-dir=$HOME/.chrome-cdp \
       --remote-debugging-port=9222 \
       --remote-allow-origins='*' \
       https://dashboard.retellai.com/
```

Log into Retell in that window. Done — every later run attaches to this profile.

Then confirm reachability and that the tooling can see it:

```bash
curl -s http://127.0.0.1:9222/json/version          # browser alive?
export CDP_URL=http://127.0.0.1:9222                # only if not the default port
node scripts/conductor.mjs status
```

**If a project runs its own Chrome on another port, the logins may live in a different profile.**
Two Chromes with different `--user-data-dir` have completely separate cookies. Check which one is
actually authenticated before concluding a session is dead:

```bash
# per port: does this profile hold the logins?
node -e 'import("playwright").then(async ({chromium})=>{
  const b=await chromium.connectOverCDP("http://127.0.0.1:PORT");
  const c=await b.contexts()[0].cookies();
  console.log(c.filter(x=>x.domain.includes("retellai")).length,"retell cookies"); await b.close();})'
```

`scripts/conductor.mjs` needs Playwright. As a global skill it has no `node_modules`, so run it from
a project that has Playwright installed, or set `PLAYWRIGHT_PATH=/path/to/such/project`.

---

## The loop

Each pass: **snapshot → prompt → review → accept → verify → audit → simulate → fix at root → record.**

```bash
S=~/.claude/skills/retell-voice-agent/scripts
export RETELL_API_KEY=...          # from your secret store, never committed
FLOW=conversation_flow_xxxx
AGENT=agent_xxxx
```

**1. Snapshot — this is your revert point.** Never skip it.
```bash
node $S/snapshot.mjs save $FLOW before.json
```

**2. Discard stale tab state.** An open tab autosaves and can clobber API changes.
```bash
node $S/conductor.mjs reload
node $S/conductor.mjs open $AGENT
```

**3. Prompt with invariants.** Write the prompt to a file. It MUST contain the five elements in
[VERIFICATION.md](VERIFICATION.md#constraining-an-ai-reviewerditor): what the agent is; invariants
*with reasons*; known gaps marked accepted; a numbered scorecard demanding it check **conditions,
not just prompt text**; and "report passes too, apply nothing until I approve."
```bash
node $S/conductor.mjs send review-prompt.txt
node $S/conductor.mjs wait 900
node $S/conductor.mjs read 8000
```

**4. Review proposals before accepting.**
```bash
node $S/conductor.mjs pending
```

**5. Accept or reject.** Accepting is two steps (Accept all → Submit); the script does both.
```bash
node $S/conductor.mjs accept     # or: reject
```

**6. Verify the "nothing else was touched" claim — do not trust it. This step is not optional.**
```bash
node $S/snapshot.mjs save $FLOW after.json
node $S/snapshot.mjs diff before.json after.json      # exits 1 on unexpected change
```

Conductor writes from **its own cached copy of the flow**, so accepting any change can silently revert
your out-of-band API edits to *other* nodes — while its summary and the UI both report touching only
one. This has happened in practice; assume it will happen again.

If the diff shows a node you didn't expect, **restore surgically** rather than wholesale — a full
`restore` would also discard the change you just approved:
```bash
# take the clobbered node from before.json, keep everything else from after.json, PATCH nodes back
```
Then re-assert *both* fixes are present. Full revert only if the whole change is bad:
`node $S/snapshot.mjs restore $FLOW before.json`.

**Rule of thumb: one writer per node per session.** If Conductor is going to touch a node, let it own
that node; if you're editing via API, don't hand Conductor work until you're done.

**7. Static audit.**
```bash
node $S/audit-flow.mjs $FLOW policy.json              # exits 1 on FAIL
```

**8. Simulate.** Conductor will not run billed simulations without an explicit go-ahead in the prompt.
State pass criteria per scenario *before* running, and demand quoted transcript evidence.

**9. Fix at the root, via API.** Deterministic, no Conductor quota, no UI hazards. Then re-verify
from step 6.

**10. Record the finding** — what broke, the root cause, which layer caught it.

---

## Prompt patterns that work

**Review** — invariants + scorecard + "report passes too" + "apply nothing until I approve."

**Simulation** — one numbered scenario per line with an explicit PASS *and* FAIL condition. Vague
criteria produce vague verdicts:

> PASS = confirms the chosen window in its own turn **before** the frame-break.
> FAIL = jumps straight to the frame-break, or crams both into one turn.

**Reporting a fix you made yourself** — state the root cause, the exact change, and *why* it is
right. Conductor then verifies rather than re-proposing, and flags regressions your fix introduces.
Always name the regression risk explicitly:

> This is the regression risk of Fix A — test it hard. If it fails, that's a safety regression and
> I want the root cause immediately.

---

## Reading its output honestly

- **A FAIL may be a bad metric, not a bad agent.** One run failed because the agent never asked for a
  name the caller had already volunteered. Read the transcript before fixing anything.
- **A PASS reached via fallback is UNTESTED.** Confirm the mock fired and returned what you intended.
- **It will tell you when a rerun is pointless** ("this is a repeat, rerunning would just bill you").
  Believe it; it saves quota.
- **Its asides are often the most valuable part.** One throwaway note about `arguments: "{}"` turned
  out to be a production bug that would have made a whole branch permanently dead.

## Budget

Per-user and per-workspace daily message caps (workspace usually bites first); simulations bill per
run. So: **use Conductor for review and simulation — its genuine strengths — and make config changes
via the REST API.** Batch questions into one prompt rather than a conversation.
