# Agent skills

Skills I use day to day. Each folder is one skill in the open Agent Skills format: a `SKILL.md` (a `name`, a `description`, then the instructions) plus the scripts and reference notes it uses. The same folder works in Claude Code, Codex and the ChatGPT desktop app. Each `SKILL.md` ends with a short **Running on Claude, Codex and ChatGPT** section for the few places they differ.

| Skill | What it does | Needs |
| --- | --- | --- |
| [ship](ship) | Closed-loop acceptance gate: build, prove by real use with a fresh verifier, fix from the repro, re-prove, until PASS or provably stuck | Your app's build and launch commands |
| [cloud-browser-login](cloud-browser-login) | Logs into your own accounts on any website from a cloud session, in a real Chromium browser, and records what it learns per site | Node, Playwright, Chromium |
| [retell-voice-agent](retell-voice-agent) | Design, build, audit and verify Retell AI voice and SMS agents | Node, `RETELL_API_KEY` |
| [deepgram-voice-agent](deepgram-voice-agent) | Build and gauntlet-test Deepgram Voice Agent API agents with persona scenarios | Node, `ws`, `DEEPGRAM_API_KEY` |
| [dialora](dialora) | Build, configure and verify Dialora.ai voice agents end to end | Node, Playwright, a logged-in Chrome |
| [autonomous-systems-audit](autonomous-systems-audit) | Read-only health audit of a self-driving agent harness, its tests, knowledge graph and memory | Python 3, a CC-MAESTRO checkout |
| [pme-cdp](pme-cdp) | Drive an already-logged-in Chrome over CDP instead of a fresh, logged-out browser | Node, Playwright, Chrome with remote debugging |

## Install

```bash
git clone https://github.com/jdgafx/jdgafx
cd jdgafx/skills
./install.sh both            # every skill, for Claude Code and Codex
./install.sh codex ship      # one skill, Codex only
```

`install.sh` copies each folder into the skills directory of the tool you pick. To do it by hand, copy a skill folder into one of the places below.

### Claude Code

| Scope | Folder |
| --- | --- |
| You, every project | `~/.claude/skills/<skill>/` |
| One repository | `<repo>/.claude/skills/<skill>/` |

Claude picks a skill when your request matches its `description`, or you can name it (`/ship`). On claude.ai, zip a skill folder and upload it under Settings → Capabilities → Skills.

### Codex (CLI, IDE extension) and the ChatGPT desktop app

| Scope | Folder |
| --- | --- |
| You, every project | `~/.agents/skills/<skill>/` |
| One repository | `<repo>/.agents/skills/<skill>/` (Codex also checks the folder you launch from and the repo root) |
| Whole machine | `/etc/codex/skills/<skill>/` |

1. Copy the skill folder there (or run `./install.sh codex`).
2. In Codex, run `/skills` to check it's listed. Codex picks up new skills on its own; restart it if one doesn't appear.
3. Use it by typing `$` and the skill name (`$ship`), or just describe the task and Codex picks the skill whose `description` matches.
4. In the ChatGPT desktop app, the same skills show under **Skills** in the sidebar; type `@` to pick one.

Reference: OpenAI's [skills guide](https://learn.chatgpt.com/docs/build-skills).

### Secrets

None are stored here. Scripts read keys from environment variables (`RETELL_API_KEY`, `DEEPGRAM_API_KEY`, `DIALORA_TENANT_API_KEY` and so on); set them in your shell or your tool's environment settings.
