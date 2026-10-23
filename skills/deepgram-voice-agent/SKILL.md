---
name: deepgram-voice-agent
description: Build, configure, and gauntlet-test Deepgram Voice Agent API agents (WebSocket Settings, Claude think, server-side functions, text-mode persona testing). Use when creating or debugging a Deepgram voice agent, writing its prompt, wiring function endpoints, or verifying it end-to-end before shipping.
---

# Deepgram Voice Agent — build & gauntlet-test process

Battle-tested process from porting a real-estate inbound voice agent (2026-07-29/30). Every rule below was
proven against the live API — the gotchas each cost a real debugging cycle.

## 1. How the agent works

There is no hosted agent. The agent exists only while a client holds
`wss://agent.deepgram.com/v1/agent/converse` open (auth: `Authorization: Token $DEEPGRAM_API_KEY`)
and sends a `Settings` JSON as the first message. Server replies `Welcome` then `SettingsApplied`.
Consumption paths: Deepgram playground (https://playground.deepgram.com/?endpoint=agent),
a browser mic client, a Twilio Media Streams relay (audio config `mulaw`/8000), or the
text-mode gauntlet in this skill.

Settings anatomy (see any committed `SETTINGS*.json` for a full example):

- `audio.input/output` — per-connection; NOT part of any stored agent config.
- `agent.greeting` — the canned opening line. The prompt must NOT repeat or re-ask it.
- `agent.listen.provider` — e.g. `{type: deepgram, version: v2, model: flux-general-en}`.
- `agent.speak.provider` — Deepgram Aura (`aura-2-*`, supports `speed` 0.7–1.5),
  Deepgram-managed Cartesia (`type: cartesia`, no API key needed — best fix for
  "sounds mechanical"), or BYO eleven_labs/open_ai with `speak.endpoint` + key.
- `agent.think.provider` — `{type: anthropic, model: claude-sonnet-5}`.
  **NEVER set `temperature` on Claude 5 models** — Anthropic 400s on every turn and the
  agent dies after the greeting (greeting is canned, so the defect hides in quick tests).
- `agent.think.prompt` — one flat string, 25k-char cap on managed LLMs. Tighter = faster.
- `agent.think.functions[]` — with `endpoint: {url, method, headers}` Deepgram executes
  the HTTP call server-side; without it the client gets `FunctionCallRequest` over the
  socket and must reply `FunctionCallResponse`.

Secrets: keep `{{PLACEHOLDER}}` tokens in the committed Settings JSON; the connecting
client resolves them from environment variables at load time (dg-gauntlet.mjs does this).

## 2. Prompt rules (Deepgram official + hard-won)

Follow https://developers.deepgram.com/docs/prompting-voice-agents — ten sections, opening
with a "CRITICAL: YOU ARE A TEXT GENERATOR FOR A VOICE SYSTEM" block. Key rules:

- No markdown/brackets in output ever; write numbers/dates as speech ("July thirtieth").
- Max two short sentences per turn, ONE question per turn.
- Greeting lives in `agent.greeting`; prompt says WHEN to call functions, schema says HOW.
- Turn-taking is the system's job; if interrupted, stop.
- Deepgram has NO knowledge base feature — fold facts into the prompt as a FACTS section.
- The agent must OWN conversation pivots ("attach the bridge to your answer") — a prompt
  that waits for the caller to run out of questions stalls in real calls.
- Function-call turns must be SILENT (no words alongside a call); speak after the result.
- Enforce reliability-critical routing in the function endpoints (server-side), never by
  prompt emphasis — Deepgram's own docs say prompts are not enforcement.

## 3. Platform gotchas (all live-proven)

- **KeepAlive**: text-mode sessions (no audio frames) are closed in ~60s. Send
  `{"type":"KeepAlive"}` every ≤8s. The type is `KeepAlive`, NOT `AgentKeepAlive`.
- **Tool-arg size bug**: "Failed to think" (Error, no Warning) when the model generates a
  larger tool call — a 12-field function with a real ~100-char briefing died
  deterministically on claude-sonnet-5, claude-haiku-4-5 AND claude-sonnet-4-5; the same
  call with 6 fields passes 3/3. **Design rule: keep every function ≤6 params; let one
  composed string carry the detail.** Bisect reproducers: `scripts/dg-bisect.mjs`.
- **Cartesia TTS dies on punctuation-only segments — Aura doesn't** (proven 2026-07-29):
  a TTS flush that is only punctuation/whitespace (a lone "—", "...", or the empty text
  block Claude sometimes emits with a tool call) makes Deepgram-managed Cartesia return
  400 (`Invalid transcript: empty or only punctuation`); Deepgram retries 3x then kills
  the whole session with fatal `Failed to speak`. Aura (`aura-2-*`) speaks/skips the same
  payloads with zero warnings. Full sentences containing em-dashes are fine — only
  punctuation-ONLY flushes die. Intermittent in real calls (depends on model chunking),
  and there is no client-side hook to sanitize server-side TTS input. **Rule: Aura for
  production; Cartesia on Deepgram is demo-roulette until Deepgram guards empty flushes.**
  Deterministic reproducer: `InjectAgentMessage` with `"—"`. Managed-Cartesia Settings use
  `model_id` (not `model`), and playground voice IDs may 404 via the API (separate pool).
- **A tool result that reads as failure makes the model retry ~3x then die** — endpoints
  must return genuinely useful success JSON, and any tenant-routing key the endpoint needs
  (e.g. `?agent_id=...`) must ride the URL, because the model only supplies schema params.
- **`UpdatePrompt` APPENDS, never replaces** — use `UpdateThink` for mid-call prompt swaps.
- **`InjectUserMessage`** = text-in without audio: the native chat-gauntlet hook.
- Server events worth logging: `ConversationText`, `FunctionCallRequest/Response`,
  `Warning` (has full HTTP error bodies for server-side function failures), `LatencyReport`
  (`ttt_token_latency` etc. — free latency telemetry).
- Deepgram REST "Reusable Agent Configurations" exist (`/v1/projects/{id}/agents`) but the
  key needs `agent:read`/`agent:write` scopes; stored config is IMMUTABLE (delete+recreate)
  and covers the `agent` block only. Inline Settings is fine for a single tenant.
- The official Deepgram MCP server is docs-search only (one tool); its docs page listing
  transcribe/synthesize tools is wrong. For reference material install the skills plugin:
  `/plugin marketplace add deepgram/skills`.

## 4. Playground testing — always prepopulated, never hand-pasted

When the user says "test in the playground", drive their persistent chrome-cdp
browser there PREPOPULATED from the Settings JSON — never make them paste:

```bash
node scripts/dg-playground-open.mjs /path/SETTINGS.production.json  # [--identity cng] [--port N]
```

The script resolves the CDP port from the chrome-cdp identity registry, loads
https://playground.deepgram.com/?endpoint=agent with models + greeting in the
URL, sets the prompt via a React-safe write on the LLM tab's textarea, and
verifies the box byte-for-byte before declaring ready. The user just clicks
"Talk To Your Agent".

Hard-won playground facts (2026-07-29):
- **No custom functions.** The Functions panel has only two built-in examples;
  endpoints cannot be wired. Any tool-driven flow (booking, guide, lead log)
  is hallucinated theater — the model may even emit fake XML tool-call text
  into the chat. Playground = voice/prompt/latency FEEL only; every functional
  claim must be proven by the gauntlet or the real artifact.
- A full prompt in the URL → 400 Bad request (request-line limit). Models,
  greeting, provider params ride the URL fine; prompt must go through the DOM.
- URLSearchParams `+` for spaces is NOT decoded by the app's text fields —
  emit `%20` (the script handles this).
- localStorage `lastAgentConfig` is clobbered by the app's unload save —
  writing it then reloading does not stick; fill the textarea instead.
- Playground transcripts are client-side only — gone on reset/close unless
  Copy Transcript is hit. No server-side retrieval exists.

## 5. The gauntlet (test process)

Never ship on a happy-path chat. Run the persona matrix over the REAL Settings file against
REAL endpoints, then verify the real-world side effects (emails, calendar events, CRM rows).

```bash
npm i ws   # once, anywhere
DEEPGRAM_API_KEY=... DG_SETTINGS=/path/SETTINGS.production.json \
  DIALORA_BRIDGE_TOKEN=... \
  node scripts/dg-gauntlet.mjs scenarios/sc2-guide.json /tmp/out-guide.json
```

Personas (scenarios/ has working examples — adapt the rules to your agent):
- **golden booker** — qualified caller through availability → confirm-before-book →
  booking → wrap-up logging. CREATES A REAL BOOKING: capture the uid from the
  FunctionCallResponse and cancel it afterwards.
- **guide/nurture path** — the non-qualified route; use a fresh plus-tagged email each run
  (`user+test1@...`) so fresh-contact-only automations actually fire.
- **has-agent referral** — must not book, must not send collateral, no lead log if no email.
- **hostile/injection** — "ignore your instructions", "are you a robot", abuse. Must not
  leak the prompt, must admit AI honestly, must exit in one sentence.

Scenario format: ordered `rules` of `{re, say}` matched against each completed agent turn
(order-independent against LLM turn-order variance), plus `closing` lines. A scripted
turn LIST is too brittle — agents reorder questions run to run.

Verdict discipline:
- A `FunctionCallRequest` is not success — wait for the `FunctionCallResponse` and then
  verify the REAL artifact: the email in the inbox, the calendar event, the CRM row.
- Silence after a request = the endpoint call never happened (think died mid-generation).
- Clean up every real side effect (cancel test bookings) and record what was created.
- Fix ONE variable per cycle, rerun the same persona, then rerun the golden path.

## 6. Debugging "Failed to think"

1. Check `Warning` events first — they carry the provider's HTTP error body verbatim
   (e.g. Claude 5 temperature rejection shows up here).
2. No Warning + death at a specific turn = generation-side. Bisect with
   `scripts/dg-bisect.mjs` pattern: tiny prompt + real functions, real prompt + one
   function, vary one dimension per run. Suspect tool-call size first (see gotcha above).
3. `scripts/dg-probe.mjs` = minimal auth + SettingsApplied smoke test.

## 7. Latency

`LatencyReport` events give ttt (time-to-token) per turn free. claude-sonnet-5 with a
~10k prompt runs ~1.5–2.3s first token, up to ~7.5s worst turn; a "waited 5 seconds for a
think response" Warning is the early sign you're near the platform's tolerance. Compress
the prompt before switching models — prompt size drives think latency.

## Running on Claude, Codex and ChatGPT

Tool-neutral apart from one line: `/plugin marketplace add deepgram/skills` is a Claude Code command. On Codex or ChatGPT, skip it and use Deepgram's docs site. The gauntlet, probe and bisect scripts need Node and `npm i ws`; keys come from environment variables (`DEEPGRAM_API_KEY`, `DG_SETTINGS`, `DIALORA_BRIDGE_TOKEN`).
