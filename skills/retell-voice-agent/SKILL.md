---
name: retell-voice-agent
description: Design, build, audit and verify Retell AI voice and SMS/chat agents — model and Fast Tier selection, conversation-flow structure, structural safety guarantees, Conductor use, and a three-layer verification method. Use when building or reviewing a Retell agent, choosing a Retell model or voice, wiring conversation flows or tools, driving the Retell dashboard/Conductor, debugging an agent that says or does the wrong thing on a call, or when the user mentions Retell, retellai, voice agent, AI receptionist, inbound/outbound calling agent, or A2P/SMS for an AI phone agent.
---

# Retell voice agent design

Building a Retell agent that survives real calls. The failure modes here are non-obvious and most
are invisible from the dashboard — this skill front-loads them.

## The three laws

1. **Prompt text is not capability.** `general_tools` (or flow tool nodes) are a separate array.
   Writing "end the call" / "press 1" / "text them the link" in a prompt grants *nothing*.
2. **Structure beats wording for anything that must never happen.** Don't tell the agent not to book —
   *don't attach a booking tool*. Absence of the tool is the guarantee; prompt wording is a request.
3. **Newer is not faster.** Latency dominates perceived quality on a call. Verify model latency against
   the platform's own figures before "upgrading". See [REFERENCE.md](REFERENCE.md).

## Workflow

**0. Data reality check — do this BEFORE designing.** For every dynamic variable, measure what
percentage of real records can actually populate it. Design for the *missing* case as the default,
not the exception. A demo that names a business it cannot situate reads as thin, and no prompt
fixes absent data. Skipping this step is the most common cause of a technically-correct, useless agent.

**1. Channel + model.** Voice vs chat are different agent objects with different endpoints
(`list-agents` is voice-only; chat agents need `list-chat-agents`). Pick the model on measured
latency, not recency. Fast Tier is a per-model toggle, not a tier of its own.

**2. Design the flow.** Single prompt is fine under ~5 functions; past that use a Conversation Flow.
Every path needs a real terminal node. Put anything safety-critical on its own branch that is
*structurally* unable to reach the dangerous nodes.

**3. Build.** Wire tools explicitly. Give every variable a safe default — and check the default reads
grammatically in the sentence that uses it (see PITFALLS: double-article).

**4. Audit — three layers, none sufficient alone.** Run `scripts/audit-flow.mjs`. See
[VERIFICATION.md](VERIFICATION.md) for why each layer catches a class the others miss.

**5. Simulate.** Write pass criteria *before* running, and verify each test actually exercised its
path — a scenario whose mock never fired is a false pass, not a pass.

**6. Ship.** Publish (agents default to unpublished, version 0), attach a number, fill webhook
variables. Confirm the outcome enum covers *every* terminal path including opt-out.

## Conductor

Dashboard-only, zero API, hard daily message caps. A strong reviewer and a dangerous editor: it will
"helpfully" re-add a tool you deliberately omitted or upgrade a model you deliberately pinned.

Run it inside the loop in **[CONDUCTOR-LOOP.md](CONDUCTOR-LOOP.md)** — copy-paste commands, from
Chrome/CDP login through review, accept, verify, audit and simulate. Never freehand.

Non-negotiables: **snapshot before accepting anything** (your revert point), state invariants *with
reasons* in the prompt, forbid blanket-apply, and **verify by API diff** rather than trusting
"nothing else was touched."

## Making changes

Prefer the **REST API** over the dashboard for config changes — it is deterministic, costs no
Conductor quota, and avoids the UI hazards in [PITFALLS.md](PITFALLS.md). The dashboard tab and the
API are two writers to one object; a stale tab can silently clobber an API change.

## Files

- [CONDUCTOR-LOOP.md](CONDUCTOR-LOOP.md) — CDP/login setup + the copy-paste improvement loop
- [TUNING-LOOP.md](TUNING-LOOP.md) — the 5-stage iterative tune loop to human-indistinguishable: golden calls, native sim/batch, audio-LLM grading (MOS ≥4.3), latency/naturalness levers (<800ms), known killers
- [REFERENCE.md](REFERENCE.md) — models, Fast Tier, tools, limits, SMS/A2P, voice settings, prompts
- [PITFALLS.md](PITFALLS.md) — symptom → cause → fix for every trap found the hard way
- [VERIFICATION.md](VERIFICATION.md) — the three-layer audit and simulation discipline
- `scripts/conductor.mjs` — drive Conductor over CDP (status/open/send/wait/read/pending/accept/reload)
- `scripts/audit-flow.mjs` — policy-driven flow audit (reachability, global nodes, dead ends, tools)
- `scripts/snapshot.mjs` — snapshot/diff/restore a flow around any risky edit

Scripts need Playwright; as a global skill this dir has no `node_modules`, so run them from a project
that has it or set `PLAYWRIGHT_PATH`. `RETELL_API_KEY` comes from your secret store at call time.

## Running on Claude, Codex and ChatGPT

Tool-neutral. The scripts are plain Node (Playwright only for `conductor.mjs`), the Retell work goes through its REST API with `RETELL_API_KEY` from your environment, and nothing depends on Claude Code tools. Copy the folder into either skills directory as is.
