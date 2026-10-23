# Verification — three layers, none sufficient alone

A real session found three defects in one agent. Each was invisible to the other two methods. That
is the whole argument for running all three.

| defect | edge-topology walk | static review | live simulation |
|---|---|---|---|
| safety branch wired back into booking | **catches** | maybe | maybe |
| global node fires inside safety branch | misses (orthogonal to edges) | **catches** | maybe |
| node transitions before its instruction runs | misses | misses | **catches** |

Never report "structurally proven" on the strength of one layer. Name which layer proved what.

---

## Layer 1 — edge topology

Walk the graph from each safety-critical node and assert it cannot reach the forbidden nodes.
Mechanical, fast, and the only layer that gives a *hard* guarantee. Re-run after **every** edit —
especially anything an AI assistant touched, since "helpfully" reconnecting a branch is its most
likely error.

Follow `edges[]`, `always_edge`, `skip_response_edge`, and `else_edge` — missing one silently
under-reports reachability and produces a false all-clear.

`scripts/audit-flow.mjs` does this from a policy file.

## Layer 2 — static review (global nodes, tools, defaults)

What the walk cannot see:

- **Global nodes** — attach to every node regardless of edges. Audit every condition. Dangerous
  conditions must be scoped by naming the specific phase/nodes, never by a soft phrase the model
  interprets. Safety-positive globals (AI disclosure) should be widened to fire *everywhere*.
- **Tool inventory** — assert forbidden tools are absent. This is your real guarantee for
  "must never happen" behaviours.
- **Variable defaults** — substitute each into the literal sentence and read it. Catches the
  double-article class.
- **Terminal coverage** — every path ends in a real end node; every terminal has an outcome value.
- **Binary-offer coverage** — every node that poses an accept/decline choice has an edge for *both*
  outcomes, not just the accept path. A single valid edge passes the reachability walk and the
  terminal-coverage check; it still strands a decline (see PITFALLS: binary-offer node).

An LLM reviewer is genuinely good at this layer *if* you constrain it — see the prompt recipe below.

## Layer 3 — live simulation

The only layer that catches timing and ordering: instruction/transition races, stacked questions the
model produces despite instructions, and how defaults actually render in speech.

Discipline:

1. **Write pass criteria before running**, specific enough to fail. "Handles it well" is not a
   criterion; "confirms the chosen window in its own turn *before* the frame-break" is.
2. **Push adversarially** on anything safety-critical. Three different attacks minimum on the branch
   that must never break — insist, ask for a price, assert a false premise.
3. **Verify the test exercised its path.** A pass reached via fallback is UNTESTED (see PITFALLS).
   Confirm mocks fired and returned what you intended.
4. **Check the specific string you patched actually rendered.** Models paraphrase around templated
   clauses, so a patched sentence may never appear. Absence of the bug is not proof of the fix —
   force a run that recites the clause verbatim.
5. **Quote transcript evidence** per scenario. A bare PASS is not a result.
6. **Run at least one scenario with every optional variable left at its default**, matching your
   worst real record. Tests with realistic data populated hide the semantically-empty-default class
   entirely (see PITFALLS) — the agent passes every structural check and still talks in circles.

---

## Constraining an AI reviewer/editor

Without constraints it re-adds tools you deliberately omitted and "upgrades" models you pinned.
With them it is a genuinely strong reviewer. Include all five:

1. **What the agent is** — one paragraph of real context, including who calls and why.
2. **Invariants, with reasons.** "Model is X + Fast Tier — deliberate and measured, newer tested
   *slower*, do not propose an upgrade." "No booking tool, and never add one — the absence *is* the
   safety guarantee." Reasons matter; a bare prohibition gets rationalised around.
3. **Known gaps, marked accepted** — so it doesn't spend the review re-reporting what you know.
4. **A concrete scorecard** — numbered checks, and demand it *check conditions, not just prompt text*.
5. **"Report passes too. Apply nothing until I approve."** Negative results tell you what was
   actually examined, and per-item approval keeps you in control.

Then: **snapshot before accepting**, and **diff via API afterward** — assert model, tools, variables,
node count and reachability are unchanged, and that only the nodes it named were touched. Verify the
"nothing else was touched" claim; don't take it.
