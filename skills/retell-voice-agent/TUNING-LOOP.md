# The tune loop — iterative refinement to human-indistinguishable

Research-grounded (2026-07-21, industry + Retell/ElevenLabs canonical docs). The loop replaces
manual call-and-listen QA, which fails on long calls (nobody remembers every line) and doesn't scale.

## Five stages, in order

**1. Golden-call library.** Canonize every instructive call: `recording_url` + transcript +
expected outcome. 50+ is the industry norm. Run the full set before EVERY prompt change; any
metric moving >5% the wrong way blocks the change. Most production incidents trace to skipped
regression runs on "small" prompt edits.
https://hamming.ai/blog/ai-voice-agent-regression-testing

**2. Retell native simulation + batch tests — the primary regression harness. Do not build one.**
Persona = 3 sections: Identity / Goal / Personality (incl. escalation traits, e.g. "patient but
frustrates if unresolved"). LLM plays the caller; hundreds of sims, no real calls. LLM-judge
metrics: Task Completion, Function Execution (right tools fired), Response Quality. Supports
dynamic test variables + custom-function MOCKING (sims must never fire real bookings).
Save sims as reusable test cases → assemble batch file → one command reruns everything.
https://docs.retellai.com/test/llm-simulation-testing
CI wiring example: https://dev.to/pld/how-to-test-a-retell-agent-in-ci-with-github-actions-2cjb

**3. Audio-LLM grader — the piece nobody sells cheap; build it.** Transcripts cannot show robotic
phrasing, awkward gaps, talk-over. Feed the RECORDING to an audio-capable LLM (Gemini audio-in,
GPT-4o audio) with a MOS + prosody rubric: naturalness / pauses / barge-in handling / robotic
phrasing, 1–5 each. Add UTMOSv2 (open model, offline) for objective MOS. Target **MOS ≥4.3 =
human baseline**. Nightly: replay scenarios → pull recordings → grade → diff vs last run.
Retell's `recording_multi_channel_url` (agent/caller on separate tracks) makes interruption and
talk-over detection mechanical. Per-turn `latency.e2e` values ship on every call object already.
https://elevenlabs.io/blog/voice-agent-evaluation-framework-6-pillars-explained

**4. Naturalness levers (numbers).**
- **e2e latency <800ms** — the #1 tell. >800ms = noticeable pauses, >1500ms = feels broken.
  Budget: VAD 50 + STT 150 + LLM TTFT 400 + TTS 150 + net 50. Platform baselines 2026:
  Retell 580–620ms, ElevenLabs 400–600ms.
  https://rnikhil.com/2025/05/18/how-to-reduce-latency-voice-agents
- **MOS ≥4.3**; TTS speed 0.9–1.1x.
- **ElevenLabs voice settings baseline:** stability ~0.50, similarity ~0.75, style 0.
  Stability 0.60–0.85 = consistent but monotone; 0.30–0.50 = dynamic but can wobble.
  Stability×clarity is multiplicative (high+high = rigid). Hold prompt constant, sweep settings.
  https://elevenlabs.io/docs/eleven-agents/customization/voice/best-practices/conversational-voice-design
- **Barge-in:** yield the floor on a real interrupt; keep talking through backchannels
  ("uh-huh", "yeah"). Sub-100ms is the hard target.
- **Filler during tool calls** — dead air during a booking lookup is a tell; static filler works.
- **Semantic turn detection** beats silence-only endpointing (silence-only forces a bad
  latency-vs-interruption tradeoff).
  https://livekit.com/blog/turn-detection-voice-agents-vad-endpointing-model-based-detection

**5. Conductor weekly on real calls** — via CONDUCTOR-LOOP.md discipline (snapshot → review →
accept per-item → API diff). Never freehand.

## Field-proven lessons (2026-07-22 A/B on a live agent)

- **Never put example phrases in prompt rules.** A rule like "vary acknowledgments — e.g.
  months of searching gets 'so you know what's out there'" gets its EXAMPLE recited verbatim
  on real calls; the audio judge flagged the exact prompt phrase as a robotic quote. State the
  constraint ("few words, freshly worded, or skip"), never the sample wording.
- **A/B discipline that actually held up:** same judge model, same caller audio, same channel
  (web-vs-web or phone-vs-phone — web e2e latency runs ~2x phone, never cross-compare),
  `create-web-call {agent_version}` to pin each side. Overall MOS can hold flat while every
  subscore moves — read subscores, not just the headline.
- **Automated caller-bot recipe:** edge-tts lines (espeak is too garbled for Retell STT —
  names/emails never survive) + sox silence splices → Chrome
  `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream
  --use-file-for-fake-audio-capture=caller.wav` → page loading retell-client-js-sdk via
  esm.sh (the jsdelivr UMD is not self-contained). Chrome LOOPS the wav — stop the call at
  script end or the flow restarts and poisons the grade. Web calls run the LATEST DRAFT
  version unless agent_version is pinned.

## Known production killers

- **Double barge-in config**: native barge-in AND a manual interruption handler → race → double
  audio (agent finishes the old sentence while starting the new one).
  https://dev.to/brains_behind_bots/building-ai-voice-agents-for-production-16ig
- Default VAD threshold 0.3 can trigger on breathing; transcriber buffering ~800ms before firing
  adds a full second per turn.

## What the call object already carries (no extra recording setup needed)

`recording_url`, `recording_multi_channel_url` (dual-channel), `transcript_object` with
word-level timestamps, `latency` (per-turn e2e/LLM values + p50/p90/p99), `tool_calls`,
`call_cost`, `call_analysis`. Everything the grader needs ships on every call.

## Buy vs build

Build ONLY stage 3 (audio grader). Sim harness: use Retell native. Optional: Cekura $30/mo
(~150 min) for audio-native scoring without building stage 3 — cheapest commercial entry
(https://www.cekura.ai/blogs/voice-agent-testing). Hamming/Coval = enterprise, sales-contact.
