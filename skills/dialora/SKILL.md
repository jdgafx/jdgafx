---
name: dialora
description: Build, configure, verify and operate Dialora.ai voice agents end-to-end — playground builder, agent config via the session API, prompts, knowledge bases, calendar/webhook/transfer tools, workflows, campaigns, phone numbers, widget, agency sub-account provisioning, and call-transcript grading. Use when the user mentions Dialora, dialora.ai, the Dialora playground/dashboard/agency, a Dialora agent or knowledge base, or porting a voice agent to/from Dialora.
---

# Dialora end-to-end

Written against a white-label agency account (AppSumo Tier 5 lifetime).
All dashboard automation rides the logged-in Chrome session on **chrome-cdp port 9223**
(NOT 9222). Full API/auth detail, config schema, and every gotcha: [REFERENCE.md](REFERENCE.md).

## The three auth layers (pick the right one first)

1. **Session cookie** (dashboard internal API, base `https://api.dialora.ai`, flat paths like
   `/agents`) — the ONLY way to create/configure agents, KBs, tools, workflows. Drive it via
   CDP `page.evaluate(fetch, {credentials:'include'})` — see `scripts/dialora-api.mjs`.
2. **Tenant API key** (`DIALORA_TENANT_API_KEY` in `~/.claude/secrets/dialora.env`) — public
   API `/api/v1/*`: users, plans, subscriptions, calls. Agency provisioning + transcript pulls.
   There is NO agents resource in the public API at any scope.
3. **Workspace key** (`dlr_live_…`) — calls:read/write only; webhook trigger endpoint.

## Quick start — read/patch an agent

```bash
node scripts/dialora-api.mjs GET /agents?page=1&limit=50
node scripts/dialora-api.mjs GET /agents/<agent_id>
# PUT body shape (the dashboard's own): {config, language, knowledgeIds, workflowsId, prompt, type}
node scripts/dialora-api.mjs PUT /agents/<id> body.json
```

ALWAYS: GET fresh → mutate → PUT full body → GET back and diff-verify. Snapshot the GET to a
file before any PUT (rollback). After any API PUT, tell the user to REFRESH any open dashboard
tab — a stale tab's Save clobbers API-applied config.

## Workflows (in order of leverage)

1. **Create agent**: Playground chat ("I want to create a new agent" → name, inbound/outbound,
   company, goal, extractInfo). Playground CANNOT set the prompt — paste it in the editor
   (`[contenteditable]` #2 on the agent page) or PUT it. Verify verbatim: normalize blank lines,
   diff against source.
2. **Best-quality config** (proven picks): llm `gpt-4.1` (no Claude on Dialora), TTS
   `elevenlabs/eleven_turbo_v2_5` a cloned (PVC) voice speed 0.95
   simBoost 0.75 speakerBoost on, STT `deepgram/flux-general-en` + `transcriberKeywords`
   (names/places/jargon), interruption 2 words, temp 0.2, ambience off. Deepgram TTS = Aura-1
   only — robotic for spelled read-backs, don't use.
3. **Knowledge base**: `POST /knowledges {title, type:'text', text}` → poll status →
   `completed` → attach via agent PUT `knowledgeIds`. Types: text | file | website (crawl, plus
   `/knowledges/{id}/sync` re-sync). Per-client KB set (template): listing/inventory facts,
   business+process doc, pronunciations doc. Retrieval-friendly: alias lines, hard-policy
   sections, "not in this KB" list.
4. **Tools** (`config.functions[]`): `google_calendar` (native check_availability +
   create_booking), `zapier_trigger_webhook_with_data` / custom HTTP tool (CRM, guide email via
   bridge), `dialora_transfer_call` (warm transfer w/ availability schedule). Exact JSON shapes
   in REFERENCE.md.
5. **Extraction + analytics**: `config.extractionInfo` (JSON string of field→instruction) and
   `config.analytics` (lead_qualification criteria) — rewrite both to the client's routing
   definitions; this is the native scorecard.
6. **Workflows** (structural flows): node types `root, say_node, condition_node, gather_node,
   api_request_node, transfer_call_node, end_call_node` — Retell-flow-style guarantees.
   Semantics unproven: spike a trivial one before relying on it.
7. **Ship**: phone number (Phone Numbers tab / `/phonenumbers`), or Widget tab for on-page web
   voice. Test ladder: Chat With Agent → Talk to Agent → real phone call → pull transcripts
   `GET /api/v1/calls` (tenant key) and grade routing + style.
8. **Agency resale**: sub-account per client (the account avatar dropdown is the ONLY context switcher),
   plans/subscriptions/users via tenant key — fully scriptable.

## Prompting Dialora agents

Five-section framework (their composer): AI AGENT PROFILE / INTERACTION MODE / CORE
OPERATIONAL INSTRUCTIONS / ACHIEVING GOALS AND EXTRACTING INFO / CHARACTER INTEGRITY.
Their guide preaches brevity (latency): keep prompt ≤ ~4-5k chars for behavior + style rules;
push all FACTS into the KB; `{{Variables}}` supported. One question per turn, explicit
turn-taking, error-recovery lines. Hard rules stated as NEVER/ALWAYS survive small models
poorly — pair `gpt-4.1` with dense-constraint prompts.

## Verify before done

Config: GET-back diff. Voice/pacing: ear test via Talk to Agent (welcome PCM regenerates on
PUT — confirm new voice took). Booking: real calendar event lands w/ briefing. KB: ask a
listed fact AND a policy-blocked fact. Routing: persona calls (booker/guide/corrector) graded
from real transcripts.

## Running on Claude, Codex and ChatGPT

Tool-neutral. `scripts/dialora-api.mjs` is plain Node + Playwright and finds Playwright locally, through `PLAYWRIGHT_PATH`, or from a global install. Keep the tenant key in any secret store and export `DIALORA_TENANT_API_KEY` before running; the `~/.claude/secrets/` path above is just where it lived on one machine.
