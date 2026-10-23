# Retell reference

Prices and model names change — **read them live from the account** rather than trusting any table,
including this one. Method and structure below are durable; specific numbers are illustrative.

## Model selection and Fast Tier

**Fast Tier is a per-model toggle**, exposed by hovering the chevron on a model row (submenu:
Default / Fast Tier). In the API it is `model_choice.high_priority: true` (voice flows) /
`model_high_priority` (Retell LLM). It is *not* a property of one model family.

Not every model offers it. Some newer, well-marketed models have **no** Fast option at all — check
before selecting one for voice. Where a model's row already shows a "Fast" badge, the displayed price
may already *be* the Fast price, with a cheaper Default hiding in the submenu.

What it buys: a priority pool — vendor wording is "more dedicated resource to ensure lower and more
consistent latency." No SLA, no published TTFT. A live probe measured **no** gain on the HTTP chat
path. Keep it on for voice anyway when cheap (it is insurance against variance, and the chat path may
not route like voice), but treat the advertised improvement as unproven.

**Latency is the decision, not intelligence.** Vendor guidance: reasoning adds ~800ms–2s and calls
"feel broken" past ~1.5s. The oldest fast model often leads platform-wide call volume precisely
because "the upgrade is rarely worth the latency tax." A live probe found a newer flagship ran
*slower* at ~4.7x the price. **Measure before upgrading.**

Guardrail adherence did **not** differ by model in testing — every model held never-book /
never-quote / never-claim-human under direct pressure. So do not pay for a slower model on safety
grounds; enforce safety structurally instead. Newer models do tend to be *terser*, which is a genuine
voice advantage — but fix verbosity in the prompt, not by buying latency.

The dashboard is the authority when it disagrees with the public pricing page.

## Agent types and endpoints

Voice and chat are **different objects**. `get-agent` / `list-agents` are voice-only and return
"Invalid agent channel" for a chat agent — use `get-chat-agent` / `list-chat-agents`. An agent
missing from one listing is not missing.

Agents default to **unpublished, version 0**. Saved ≠ published; publishing cuts the version a phone
number can point to.

## Tools

Available: `end_call`, `press_digit`, `send_sms`, `transfer_call`, `bridge_transfer`,
`cancel_transfer`, `agent_swap`, `check_availability_cal`, `book_appointment_cal`,
`extract_dynamic_variable`, `custom` (HTTP), `code` (JS sandbox), `mcp`.

- `send_sms.sms_content` supports `{type:"inferred", prompt}` — composed from the live transcript, so
  it can reference what the caller actually said and adapt when a link is missing.
- `press_digit` needs `delay_ms` (~1500); IVR menus ignore input sent too early.
- Custom HTTP tools: mind the webhook window (~10s). Note whether response variables are compared as
  **strings** (`{{matched}} == "true"`) — a JSON boolean may not match.

## Outbound test calls

`POST /v2/create-phone-call {from_number, to_number, override_agent_id}` — `override_agent_id` is
**required** whenever the `from_number` has no outbound agent bound (the common case for a
number provisioned inbound-only). Cheapest way to test a real voice path without waiting for an
inbound call.

## Multi-tenancy

`inbound_webhook_url` on a phone number lets you override the agent ID and set dynamic variables per
call. **One templated agent serves every tenant** — no per-tenant agent, no per-tenant knowledge base
(the KB is the line item that would scale per tenant). `inbound_agents` accepts a *weighted* list,
which gives live A/B of versions — the cheapest way to settle model and prompt questions empirically.

## Economics and limits

Per-minute cost is additive: infra + TTS + LLM + telephony, plus KB if used. Watch two margin killers:
Fast Tier multiplies the **entire** per-minute rate, and concurrency burst bills the **whole call**,
not the overage. Sell with included-minute caps, never flat unlimited.

Always set `max_call_duration_ms` — an uncapped stuck call bills to the ceiling. Cap it in proportion
to the per-minute rate.

**Conductor**: dashboard-only, zero API, per-user and per-workspace daily message caps (workspace cap
usually bites first), overage per message. Cannot be scripted — per-tenant provisioning must use the
create-agent APIs.

## SMS and A2P

- One number carries **voice and SMS**; attach a chat agent for two-way SMS.
- SMS requires **A2P 10DLC registration** — a *carrier* requirement, vendor-independent. Switching
  vendors does not skip it. Applied for through Retell's dashboard, reviewed by the telephony
  provider. Weeks, manual. US only; toll-free unsupported.
- **Voice needs no A2P.** A number is buyable immediately for inbound/outbound voice.
- The "SMS-approved number pool" is **not** a workaround: shared Retell-owned numbers, **send-only**,
  and the message body is a **preset template you cannot customize or prompt**. It cannot carry a
  personalized link or hold a conversation.
- **Conversation-flow SMS node (API, verified 2026-07-21):** `type: "sms"`, `instruction` is oneOf
  standard NodeInstruction (`static_text`/`prompt` = custom message, needs A2P number) or
  `{type:"template", template:"info_collection"}` (pool preset). `success_edge` AND `failed_edge`
  are REQUIRED, with transition prompts that must be the exact enum strings `"Sent successfully"` /
  `"Failed to send"`.
- **Pre-A2P final-state pattern:** wire the custom-content SMS node BEFORE A2P clears and route
  `failed_edge` to an honest fallback node ("we'll text it shortly" — never claims sent). Real sends
  fail gracefully until approval, then the same config starts working with zero changes.
- **Playground simulates SMS success.** `agent-playground-completion` returns
  `{"status":"SMS sent successfully"}` even with no caller number and `custom_sms_enabled:false` on
  the line — it exercises the success *edge*, not the send. Only a real phone call proves delivery
  (and the failure path routing on an unapproved number).
- Registration requires a real opt-in source. Cold/scraped lists do not qualify, and laundering the
  campaign description is a worse violation than rejection. **Prospect-initiated inbound is the clean
  path** — their contact *is* the opt-in, which makes the campaign description truthful.
- Never point an AI voice agent at cold wireless numbers; an AI voice is an artificial/prerecorded
  voice for regulatory purposes. Post-consent tool, not a prospecting tool.
- Any agent that answers *as* a business must be unmistakably self-identifying to whoever is on the
  line. A demo is safe because the prospect dialed in knowing; that reasoning collapses if the demo is
  ever pushed at someone.

## Voice and speech settings

Voice is cheaper and often lower-latency from some providers than others — compare per-minute TTS
cost *and* latency, and prefer a provider supporting `voice_emotion` if you want tonal control. Set
`fallback_voice_ids` so a TTS outage degrades instead of killing the campaign.

Tuning that survived contact with production telemetry: interruption sensitivity high for noisy
callers (job sites, vehicles); backchannel frequency **below** default for B2B (defaults are too
chatty); a short begin-message delay. Treat any specific voice choice as a prior to A/B, not a
finding — there is no published evidence on TTS naturalness over 8kHz PSTN.

**Dynamic voice speed is context-dependent, not a default-on.** On a consumer booking line a real
listener heard `enable_dynamic_voice_speed` speed the agent up during rapid clarification exchanges
— and read it as *frustration* ("you could hear the AI agent's voice speed up upon questioning").
Calm-under-pressure calls (consumer, medical, anything where corrections happen): dynamic speed OFF,
fixed `voice_speed` ~0.95, plus a prompt rule that tense moments are when the agent slows DOWN.
Dynamic speed suits pace-matching contexts (B2B efficiency calls), not reassurance contexts.

## Reducing latency — the real levers, in priority order

Per https://docs.retellai.com/reliability/troubleshoot-latency.md (biggest impact first):
1. **Faster/smaller LLM model** — reasoning models cost 800ms-2s extra; verify against this call's
   own LLM latency before switching (see REFERENCE model-selection section above).
2. **Shorter prompt** — every token adds to time-to-first-token, re-paid every turn. Noticeably
   slower past ~8k tokens. Move rarely-needed detail to the KB or tool descriptions.
3. **Fast Tier** (`model_choice.high_priority: true`) — dedicated routing, reduces variance more
   than average latency.
4. **`stt_mode: "fast"`** (agent-level; docs page still titled transcription-mode.md calls this
   "optimize for speed") vs `"accurate"` — accurate mode intentionally waits ~200ms longer
   (higher endpointing) for better entity capture (numbers/dates). Default is already `fast`.
   Turn off **Boosted Keywords** too if set — it adds ASR latency.
5. **`responsiveness`** (agent-level, [0,1], default unset) — higher = agent responds the instant
   it can rather than waiting; `enable_dynamic_responsiveness: true` adapts the wait to the
   caller's own speech rate/turn-taking pace across the call.
6. TTS provider/voice choice (`voice_emotion` can add TTS latency; disable if unneeded) and network
   distance (use a number in-region for international calls).
7. Dashboard shows a turtle icon 🐢 per-feature under "Estimated Latency" on the agent page — turn
   off any turtle-marked feature not in active use; target under 1.5s estimated.

**No native "think while the caller is still talking" (speculative generation on interim ASR)
exists** — confirmed absent from the docs index (searched speculative/predictive/partial). The
closest available approximation is `stt_mode: fast` (low endpointing, starts on the earliest
plausible end-of-speech) + `responsiveness: 1` + `enable_dynamic_responsiveness: true` — none of
this triggers generation *during* speech, they only minimize the wait *after* it ends.

**A single high e2e spike (e.g. 4s) isolated to one turn, with LLM latency in-range for the rest
of the call, is provider/connection cold-start variance** — not a config bug. Diagnose via
`get-call`'s `latency` object (https://docs.retellai.com/reliability/check-actual-latency.md):
compare the spiking turn's own `llm`/`asr`/`tts` sub-values against the call's other turns before
concluding anything is misconfigured. **The playground-completion API does not measure real
voice latency at all** (no TTS/ASR round trip, text-only) — `responsiveness`/`stt_mode` changes
can only be latency-verified by a real phone/web call, never by the playground harness used for
conversational-logic regression.

## Prompt structure

`## Identity` / `## Style Guardrails` / `## Response Guidelines` / `## Task Instructions` /
`## Objection Handling`. Numbered steps with explicit "wait for user response". Keep the prompt small
— it is re-sent every turn and is a top latency lever. Move to a Conversation Flow past ~5 functions.
