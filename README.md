# Christopher Gentile

**Applied AI Engineer** building agentic systems, RAG workflows, browser automation, and production integrations with Python and TypeScript.

I turn ambiguous business workflows into observable software: model orchestration, retrieval, tool use, streaming interfaces, deployment, evaluation, and failure recovery. My background combines hands-on AI engineering with 17 years of enterprise solution delivery.

[Portfolio](https://jdgafx.github.io) · [LinkedIn](https://www.linkedin.com/in/chrisgentile1/) · [Email](mailto:cnjgentile@gmail.com)

## Selected work

### [Deployed AI application portfolio](https://github.com/jdgafx/JDGAFX_CG_GITHUB_PORTFOLIO_APPS)

Thirteen independently deployed applications on live public data, covering multi-agent research, document intelligence, verified code review, streaming voice, data analysis, model comparison, content workflows, vision, analytics, browser automation, and LangGraph agents with checkpoint rewind, human-approved GitHub issue triage, and map-reduce summarisation. Built with React, TypeScript, serverless APIs, streaming interfaces, and anthropic/claude-haiku-5.5 through OpenRouter.

**Owned:** application architecture, implementation, deployment, provider integration, and operational hardening.

**Evidence:** [source and architecture](https://github.com/jdgafx/JDGAFX_CG_GITHUB_PORTFOLIO_APPS) · [live portfolio](https://jdgafx.github.io/JDGAFX_CG_GITHUB_PORTFOLIO_APPS/)

### [Open AlgoTrade API](https://github.com/jdgafx/open-algotrade-api)

FastAPI service integrating a trading application with the Hyperliquid DEX. Includes account and portfolio flows, strategy controls, positions, trade history, health checks, and container deployment.

**Owned:** backend API design, exchange integration, persistence, deployment configuration, and operational endpoints.

**Evidence:** [source and API documentation](https://github.com/jdgafx/open-algotrade-api)

## Agent skills

Seven skills I use daily, in [`skills/`](skills). Each is a folder with a `SKILL.md` plus the scripts and notes it relies on, and each works in Claude Code, Codex and the ChatGPT desktop app. [Install instructions for both](skills/README.md#install), or run `skills/install.sh`.

- **[ship](skills/ship)**: a closed-loop acceptance gate. It builds the app, has a fresh verifier use it for real, fixes from the repro and re-verifies, until it passes or provably stops converging.
- **[cloud-browser-login](skills/cloud-browser-login)**: logs into my own accounts on any website from a cloud session, in a real Chromium browser. It picks the safest login route, asks once for exactly the secrets it needs, and records per-site lessons.
- **[retell-voice-agent](skills/retell-voice-agent)**: design, build, audit and verify Retell AI voice and SMS agents, with a three-layer verification method and a catalogue of pitfalls found on real calls.
- **[deepgram-voice-agent](skills/deepgram-voice-agent)**: build and gauntlet-test Deepgram Voice Agent API agents against persona scenarios, checking the real side effects (bookings, emails) rather than the chat.
- **[dialora](skills/dialora)**: build, configure and verify Dialora.ai voice agents end to end, from prompts and knowledge bases to tools, phone numbers and agency sub-accounts.
- **[autonomous-systems-audit](skills/autonomous-systems-audit)**: a read-only health audit of my self-driving agent harness, its test suite, knowledge graph and memory stores, backed by a telemetry probe and file and line citations.
- **[pme-cdp](skills/pme-cdp)**: drives an already-logged-in Chrome over CDP instead of a fresh browser that gets bot-blocked and logged out.

## Private production case studies

### AI website generation and quality-control pipeline

Built a resumable generation system that transforms structured lead data into fact-safe site contracts, rendered websites, deterministic checks, real-browser visual review, bounded repair, deployment, and auditable receipts. Individual failures remain isolated so a batch can continue safely.

### Human-reviewed operations assistant

Built an agentic filing workflow across email, spreadsheets, and cloud storage. It reconciles prior submissions, collects and deduplicates receipts, prepares the next filing package, and creates a reviewable draft while keeping final sending under human control.

### Self-hosted meeting intelligence

Designed an ephemeral meeting-bot control plane for Meet, Teams, and Zoom with per-participant transcription, structured summaries, protected storage, and post-processing audio deletion. The architecture targets a substantial per-hour cost reduction versus managed transcription platforms.

These production systems remain private because they include customer workflows, account integrations, deployment topology, and sensitive operational data. Sanitized architecture walkthroughs and redacted acceptance evidence are available where appropriate.

## Additional client delivery

- Built voice-agent workflows with knowledge-base grounding, calendar booking, transcript analysis, CRM updates, and lead alerts.
- Automated a 256-image audit and 153-asset Webflow replacement workflow, reducing transferred media from 274 MB to 36 MB.
- Delivered a 102-page production website rebuild with structured data, programmatic metadata, and reusable content architecture.

Client source remains private. Architecture and implementation details are available in a technical walkthrough where appropriate.

## Engineering focus

- **Agentic systems:** orchestration, tool use, evaluation, lifecycle control, and failure handling
- **Applied AI:** RAG, multimodal and voice workflows, model/provider integration, and structured outputs
- **Delivery:** Python, TypeScript, APIs, streaming, browser automation, CI/CD, and deployment
- **Enterprise solutions:** technical discovery, architecture communication, adoption, and executive alignment
