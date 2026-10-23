# Dialora reference — API surface, schemas, gotchas

Everything below verified live 2026-07-28 against a white-label agency account
(AppSumo Tier 5 lifetime). Docs mirror (75 pages + openapi.json):
a local mirror of the Dialora docs
— grep it before guessing. Public docs page renders `https://www.dialora.ai/openapi.json`
but never links it.

## Auth + contexts

- **Internal dashboard API** `https://api.dialora.ai` — flat unversioned paths (`/agents`,
  NOT `/v1/agents`). Cookie/session auth ONLY; every API key returns 401 here. Drive via CDP
  `page.evaluate(fetch, {credentials:'include'})` from an app.dialora.ai tab (port 9223).
- **Public API** `https://api.dialora.ai/api/v1/*` — `Authorization: Bearer dlr_<env>_<32>`.
  ENTIRE surface = 12 endpoints: users (GET/POST/DELETE), plans (GET x2),
  subscriptions (POST/GET/GET/PATCH plan), calls (POST/GET/GET). **No agents resource at any
  key tier — agent build/config is session-only.**
- **Key tiers**: workspace key (scope picker offers only calls:read/write) vs tenant key
  minted from the AGENCY context with all 7 scopes (users/plans/subscriptions/calls).
  Tenant key = `DIALORA_TENANT_API_KEY` in `~/.claude/secrets/dialora.env` (0600).
- **Context switching**: login carries Agency Dashboards (`ten_pf4vjndmpchem9tmmq70pglo`) /
  My Workspaces (`acc_w6tdhqnfv6dthbpj2undhfjn`, tenantId `codiste`) / Sub Accounts
  (Vocal, Kalyan). The MK avatar dropdown (`[role=option]` rows; index 0=agency-current,
  1=workspace) is the ONLY switcher — `app.dialora.ai/agency` URL silently redirects to
  `/dashboard`. Sidebar changes per context (agency: Manage Users/Payment Plans/…;
  workspace: Playground/Agents/…).

## Internal endpoints (cookie-authed, all verified 200)

`/agents` `?page=&limit=&query=` (list → `{docs:[…]}`), `/agents/<id>` (GET/PUT/DELETE),
`/agents/models` (full LLM/TTS/STT catalog), `/agents/languages`, `/agents/templates`,
`/templates?type[]=INBOUND|OUTBOUND|TEMPLATE`, `/knowledges` (GET list, POST create),
`/knowledges/<id>` (GET w/ full text, DELETE), `/knowledges/<id>/sync`, `/knowledges/discover`,
`/workflows`, `/voices?page=&limit=` (375 voices), `/providers` (connection states),
`/campaigns`, `/phonenumbers`, `/auth/user`, `/accounts`, `/users/profile`, `/users/balance`.

## Agent PUT body shape (the dashboard's own save)

```json
{ "config": { …full config object… }, "language": "en-US",
  "knowledgeIds": ["know_…"], "workflowsId": null,
  "prompt": "…", "type": "INBOUND" }
```

GET fresh → mutate config → PUT → GET back → diff. Snapshot pre-PUT JSON for rollback.
`config` keys of note: `prompt`, `agentWelcomeMessage` (+ `welcomeMessageUrl` — a cached PCM
that REGENERATES on PUT: hash changes; ear-verify after voice swaps), `llmProvider/llmModel/
llmTemperature/llmMaxTokens`, `synthesizerProvider/Model/Voice/VoiceId/SpeedOfSpeech/
SimilarityBoost/UseSpeakerBoost/BufferSize`, `transcriberProvider/Model/Keywords` (comma
string = vocab boost), `numberOfWordsForInterruption`, `extractionInfo` (JSON **string**:
`{field: instruction}`), `analytics` (array: lead_qualification/engagement_level with
criteria), `functions` (tools array), `timezone`, `ambientNoise(+Track)`, `useFillers`,
`backChanneling`, `detectVoicemail`, `hangupAfterSilence`, `callTerminate`,
`notifications` (email/sms/whatsapp on call_completed + recipient_emails).

## Model/voice catalog (from /agents/models, 2026-07-28)

- LLM: openai gpt-4 | gpt-3.5-turbo | **gpt-4.1** | gpt-4.1-mini | gpt-4.1-nano | gpt-4o-mini |
  gpt-5-nano; gemini 2.5-flash | 3.1-flash-lite; groq llama-3.1-8b | llama-3.3-70b-versatile |
  llama-4-maverick/scout | gpt-oss-120b/20b. **No Anthropic/Claude models on Dialora at all** —
  Claude-style prompting guidance does not apply to Dialora agents; write for GPT-4.1.
- TTS: elevenlabs eleven_flash_v2_5 | **eleven_turbo_v2_5** (best available); deepgram aura
  (Aura-1 ONLY, no Aura-2 — flat prosody, avoid for spelled read-backs); rime mistv2; sarvam.
- STT: deepgram nova-2* | nova-3 | **flux-general-en** (conversational + turn detection) |
  flux-general-multi; soniox stt-rt-v5; elevenlabs scribe_v2_realtime; gladia; azure.
- Voices: `/voices` → 375 (216 elevenlabs, 140 rime, 12 deepgram, 7 sarvam). your cloned (PVC)
  voice appears here by its ElevenLabs voice id.

## Tool (functions[]) shapes — copied from working agents

Key format: `tool_<24 lowercase alnum>` (generate randomly).

```jsonc
// Google Calendar (native booking; google provider connected at account level)
{ "key":"tool_…", "id":"google_calendar", "providerId":"google", "method":"google_calendar",
  "config":{ "description":"<when to use + only-offered-times + briefing mandate>",
    "timeZone":"America/Los_Angeles", "check_availability":true, "create_booking":true,
    "find_appointment":false, "cancel_appointment":false, "reschedule_appointment":false,
    "google_calendar_id":"<gcal email>", "meeting_duration":[15],
    "working_hours":[{"weekday":"monday","start_time":"09:00","end_time":"19:00"}, …],
    "pre_call_message":"…" } }
// Zapier webhook (fires with call data; also the pattern for CRM/guide-email bridges)
{ "key":"tool_…", "id":"zapier_trigger_webhook_with_data", "providerId":"zapier",
  "method":"trigger_webhook_with_data", "config":{ "webhookUrl":"https://hooks.zapier.com/…" } }
// Warm transfer with availability schedule
{ "key":"tool_…", "id":"dialora_transfer_call", "providerId":"dialora", "method":"transfer_call",
  "config":{ "description":"…", "phoneNumber":"+1…", "preCallMessage":"…",
    "availability":false, "availabilitySchedule":[{"day":"monday","available":true,
      "availability":[{"startTime":"09:00","endTime":"17:00"}]}, …] } }
```

```jsonc
// Custom HTTP tool (verified 2026-07-28 by capturing the dashboard's own PUT):
// wrapper is REQUIRED — the docs' flat JSON shape gets SILENTLY STRIPPED on PUT.
{ "key":"tool_<24>", "id":"custom_task", "providerId":"dialora", "method":"custom_task",
  "config":{ "key":"<same tool_ key>", "name":"send_preapproval_guide",
    "description":"<LLM trigger conditions — this drives invocation>",
    "pre_call_message":" ",   // MUST be non-empty (a single space passes); empty ⇒ whole tool silently stripped
    "parameters":{ "type":"object", "required":["email"], "properties":{ "email":{"type":"string","description":"…"} } },
    "value":{ "method":"POST",
      "param":{ "email":"%(email)s" },  // MUST map every parameter to its %(name)s placeholder — the dashboard UI
                                        // saves param:{} and then the runtime posts an EMPTY body (proven live);
                                        // fill the map via API PUT or no data ever reaches your endpoint
      "url":"https://…/route?static_key=value",  // static values (agent_id) ride the URL query — no custom headers possible
      "api_token":"Bearer <token>" } } }        // becomes the Authorization header
```
Custom-tool gotchas: 5-second response budget; the UI form (Advanced Settings → Data
Integration & Tools → Add Tools → "Add Custom Tool" card "+") needs EACH parameter card's own
Save clicked, "Is required?" is a Radix switch (trusted clicks only), and the Update Tool
submit stays disabled until pre_call_message is non-empty. API PUT with the wrapper shape
above is far faster than the form and verified equivalent.

## Knowledge base

- Create: `POST /knowledges {"title":…, "type":"text", "text":…}` → 201 `{id}` → status
  `in_progress` → poll to `completed` (embedding; seconds). Attach = agent PUT `knowledgeIds`.
- Types: `text`, `file` (PDF etc. via UI upload), `website` (URL crawl; `/knowledges/<id>/sync`
  re-crawls — freshness lever for client sites).
- Account-scoped: each sub-account (client) holds its own KB set. Template per client:
  (1) listing/inventory facts, (2) business + process + offer doc, (3) pronunciations/VIP
  callers. Retrieval-friendly writing: alias lines ("also called: …"), one fact per line,
  HARD POLICY section (never-answer list), "not in this KB → defer to <owner>" closing list.
- `knowledgeBaseConfigs.preCallMessage` = filler line spoken during retrieval.

## Workflows (structural flows)

Node types in the app bundle: `root, say_node, condition_node, gather_node, api_request_node,
transfer_call_node, end_call_node, placeholder_node`. State = React-Flow style
`{nodes:[{id,type,data,position}], edges:[{source,target}]}` at `/workflows`. Attach via agent
`workflowsId`. Live semantics (how condition_node evaluates, how gather_node converses)
UNVERIFIED — spike a minimal flow before building on it.

## Testing + grading

Chat With Agent (free, text) → Talk to Agent (web voice) → real phone call. Numbers live in
`/phonenumbers` (Twilio + Telnyx providers connected). Transcripts/recordings:
`GET /api/v1/calls` + `/api/v1/calls/<id>` with the tenant key → grade routing + style
(port of grade.py checks). **Chat sessions do NOT appear in `/api/v1/calls`** — they live in
the internal (cookie-auth) `GET /executions?channel=chat&sorting[0][id]=createdAt&sorting[0][desc]=true`
(the Call History page's own endpoint; `channel=call` for phone). `GET /executions/<exec_id>`
returns full transcript incl. tool-call results (booking success/slots), `extractedData`, and
native `analytics` scoring — this is the chat-gauntlet grading source. Chat driver pattern:
`~/.claude/jobs/7f87db5f/tmp/schat.mjs` (fill textarea `placeholder*="Type a message"`, Enter,
poll transcript container = 4th ancestor of textarea; "New Chat" button appears after a prior
session — click it before expecting the welcome line). Native per-call scoring = `config.analytics` criteria
(lead_qualification BEST/POTENTIAL/NONE + engagement) shown in Analytics dashboard.

## Gotchas (each cost real time)

- Playground builder CANNOT write the prompt — creates the agent + config only; it replies
  "paste it in the dashboard". Prompt editor = 2nd `[contenteditable]` on the agent page.
- Its "Enhance Prompt" button rewrites your prompt — never click when verbatim matters.
- **Stale-tab clobber**: an open editor tab holds pre-PUT state; its Save overwrites
  API-applied config. Refresh tabs after any API PUT (and vice versa — GET fresh before PUT).
- `/agents` vs `/v1/agents` discriminator: 401 = route exists/auth wrong; 404 = no route.
- Radix `button[role=checkbox]` ignores synthetic el.click() — use Playwright locator.click()
  (trusted events) and verify aria-checked per box.
- Portal dropdowns intercept pointer events; Escape can kill the whole modal — prefer raw
  coordinate clicks inside `[data-radix-popper-content-wrapper]`, `[role=option]` by index.
- Empty-body POST = free schema discovery (400 lists required fields; `{title}` alone 201s a
  knowledge — delete probes immediately).
- extractionInfo is a JSON *string*, not an object — stringify before PUT.
- Playwright: install it globally (`npm i -g playwright`) or set `PLAYWRIGHT_PATH` to a project
  that has it; scripts/dialora-api.mjs auto-resolves.

