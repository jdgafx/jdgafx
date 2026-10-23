---
name: cloud-browser-login
description: Log into the user's own accounts on any website from a Claude Code cloud session and work inside them in a real Chromium browser, e.g. filling out profiles and onboarding wizards, posting, generating media on meta.ai, or checking whether an account is active. It covers looking at the site's login screen and showing it to the user, choosing a login method (site password stored as an environment secret, an imported site session for "Sign in with Google/LinkedIn" accounts, an email code read from Gmail, or handing off to the user's own computer), and asking the user for exactly the secrets and details it needs. Use this whenever the user asks you to log in, sign in, "use my account", "do it in the cloud browser", fill something out on a website for them, or asks how a past session got into a site. That includes when they name only the site (joinglio.ai, turnfeat.ai, meta.ai or anything new) and never say "browser" or "credentials".
---

# Cloud browser login

The user wants you to work inside their own accounts on websites, but this cloud container starts with none of their logins. This skill is the whole playbook, so you never have to dig through an old session to find out how it was done. It works for any site. `references/sites.md` holds notes on sites already done, and you add to it each time.

The ideal: the user names a site and a goal. You work out how to get in and ask them once for exactly what's missing. Then you log in, do the job, and report back.

## Step 1: Look at the site's login screen and show it to the user

Check `references/sites.md` first. If the site is listed, you already know the way in, so skip to Step 3.

Otherwise, bring up the login screen:

```bash
node <skill>/scripts/probe-login.mjs https://site.example/ <primary-working-dir>/login-screens/<site>-login.png
```

It finds the Sign in link, or tries `/login`, `/auth/login` and similar paths, without logging in. It prints the ways in: Google/LinkedIn/Apple/other SSO, email + password, two-step "password instead" flows, email codes, phone. Send the screenshot to the user with `SendUserFile` (save it inside the primary working directory so their app can open it). That way you both see the same screen before deciding anything.

The user can't click inside the cloud browser, because nothing can connect into the container. When they want to "click it themselves", the loop is: you show a screenshot, they say what to pick, you click. Passwords never go through that loop. They go in environment secrets (Step 2).

## Step 2: Choose the route, then ask for exactly what's missing

Take the first route that fits. The order is about risk: each step down exposes more of the user's identity or depends on something outside the container.

| Route | Use when | You need |
|---|---|---|
| **A. Site password** | The site has its own email + password login, and the user's account has a password | `<SITE>_EMAIL`, `<SITE>_PASSWORD` |
| **B. Imported site session** | The user's account was made with "Sign in with Google / LinkedIn / Apple" (no site password) | `<SITE>_SESSION` (and maybe `<SITE>_COOKIES`) |
| **C. Email code** | The site emails a one-time code (alone or after the password) | Gmail connector, to read the newest code yourself |
| **D. User's own computer** | Nothing above works, or the site demands SMS/app 2FA every time | The user's local Claude session (Desktop app or `claude remote-control`) driving their real Chrome |

`<SITE>` is the site's name in capitals with no domain: `TURNFEAT`, `GLIO`, `META`.

**Which login method did they use?** The login screen often can't tell you how *their* account was created. Search Gmail for the site's signup or verification emails. A "Sign in with Google" notice for the site's auth domain points to Route B. A verification code at signup points to Route A or C. If it's still unclear, ask.

**Check what's already stored, by name only.** Never print, echo or inspect the values. That leaks them, and auto mode blocks it as credential exploration.

```bash
env | cut -d= -f1 | grep -iE '_(EMAIL|PASSWORD|SESSION|COOKIES)$'
```

**Ask in one message.** Cover everything the job needs: the route you picked and why (one line), the exact variable names to add, where to add them, and the non-secret details the task will need (see Step 4). For example:

> Turnfeat uses its own email + password (no Google button), so I'll log in with that. Please add two environment variables: `TURNFEAT_EMAIL` and `TURNFEAT_PASSWORD` (cloud environment menu in the session title bar → **Edit** → environment variables), then start a new session. The current one can't see new secrets. If Turnfeat emails a code, I'll read it from your Gmail.

Rules for asking:
- **Never ask for a password, token or session value in the chat.** Secrets go in the environment settings. The chat is stored and shown in the app.
- **Never use the user's Google (or other identity provider) password.** Google blocks automated and datacenter logins ("This browser or app may not be secure") and will demand phone approval. That one password also unlocks their Gmail, Drive and everything else. Route B gets you into the one site without touching Google.
- **Say that a new session is needed** after they add a secret. Then write them a short hand-off message to paste into it: the site, the goal, and any details they've already given you. The new session won't have this conversation.

**Route B instructions to give the user** (they do this in their own Chrome while logged into the site):
1. Open the site, press F12 and go to the Console.
2. Run `copy(JSON.stringify(localStorage))`. The site's own login tokens are now on the clipboard.
3. Save that as `<SITE>_SESSION` in the environment settings.
4. When the job is done, log out of the site in their Chrome. That ends the copied session.

If loading the session still lands on the login page, the site also keeps its login in cookies. Have them export cookies for that one domain only (any cookie-export extension, JSON format) into `<SITE>_COOKIES`. Never ask for Google's cookies.

## Step 3: Get the go-ahead, then log in

Loading `<SITE>_SESSION` or `<SITE>_PASSWORD` into a browser sends a credential to a website. Auto mode blocks that as possible exfiltration unless the user has clearly said to. Before the first use in a session, get an explicit go-ahead that names the site ("yes, use GLIO_SESSION to log into joinglio.ai"). If a call is still denied after that, stop and explain, then offer to add a permission rule with the `update-config` skill, or Route D. Don't look for a way around a denial.

Then:
- **Route A:** `node <skill>/scripts/password-login.mjs <SITE> <login-url> [page-to-open-after]`. It reads the env vars itself, handles one-page and two-step forms, and says so if the site asks for a code or rejects the login.
- **Route B:** `node <skill>/scripts/session-login.mjs <SITE>_SESSION <page-to-open>`. It also loads `<SITE>_COOKIES` when that's set.
- **Route C:** search Gmail for the newest message from the site (`from:<domain> newer_than:1h`), read the code and type it in. If the code goes to an inbox you can't reach (for example Proton), ask the user for the newest code. A code is short-lived and single-use, so pasting it in the chat is fine.

All of these use the same browser profile, `./cloud-browser-profile` in the working directory, so later scripts stay logged in. Run them from the scratchpad, and keep screenshots meant for the user inside the primary working directory.

**Confirm you're actually in before doing anything else.** Look at the screenshot yourself: avatar or account name, no "Sign in" button.

For long jobs, or for repo tools that attach to a running browser (like meta.ai media generation), start the persistent browser instead: `<skill>/scripts/start-browser.sh` runs Chromium under `xvfb-run` at 1440×900 with remote debugging on **:9223**, and scripts connect with `chromium.connectOverCDP('http://127.0.0.1:9223')`. Port 9223 matches the user's local Chrome setup, so tools like `tools/genmedia.mjs` work unchanged.

## Step 4: Do the job, asking instead of guessing

- **Find out what the forms want before asking.** Click through as far as you can with what you already know, note every field you can't fill, then ask for all of them in one message. Don't send ten questions one at a time. Use `AskUserQuestion` for multiple-choice fields (business type, plan tier). Use a plain list for free-text fields (address, phone, title, rates), and offer a sensible draft where one makes sense (a headline, a bio, a skills list).
- **Never invent the user's personal, legal or financial details.** Name, address, phone, business structure, tax status, rates: they decide all of these.
- **Stop before money or identity checks.** Payment and subscription pages, and ID or document uploads, are the user's to do. Tell them where you stopped.
- **Wizards may not save partial progress.** Some restart from step 1 on every reload. Check by reloading once. If it restarts, replay the finished steps and the new ones in one run with `node <skill>/scripts/step.mjs <url> '<json actions>'`. Actions are `{"fill":[selector,text]}`, `{"click":selector}`, `{"press":[selector,key]}`, each with an optional `"wait"`. The script prints the page text and every input field, so you can see what the next step asks for.
- **What the user sees may differ from what you see.** If their screenshot shows more progress than yours, their earlier answers were probably saved only in their browser. Tell them, rather than assuming either side is right.
- After each meaningful step, take a screenshot and look at it. Send the user the ones that matter.

## Environment facts

- Playwright is installed globally. The scripts import it from `$(npm root -g)/playwright/index.mjs`, because a bare `import 'playwright'` fails from the scratchpad.
- Chromium is at `/opt/pw-browsers/chromium-*/chrome-linux/chrome`. Never run `playwright install`.
- The container runs as root, so raw Chromium needs `--no-sandbox` (`start-browser.sh` adds it, and Playwright adds it itself).
- Traffic goes through `HTTPS_PROXY`. Its CA is already in Chromium's trust store, so never disable certificate checks.
- Some hosts are blocked by the network policy (`ERR_TUNNEL_CONNECTION_FAILED`). Report the host to the user and don't route around the block.

## Step 5: Record what you learned, then wrap up

Add or update the site's entry in `references/sites.md`: the login URL, the route that worked, the click path, the variable names, wizard quirks and blocked hosts. That file is why the next session won't have to ask another session how it was done. If the skill lives in a repo, commit the change so it travels.

Then tell the user what was filled in and what's left for them (verification, payment). If they gave you a `<SITE>_SESSION`, remind them to log out of the site in their own browser. The cloud browser and its login vanish with this container.

## Running on Claude, Codex and ChatGPT

The scripts are plain Node + Playwright and run the same under any agent. Where the steps name a Claude Code tool, use the closest equivalent:

| Step says | Claude Code | Codex / ChatGPT |
| --- | --- | --- |
| Send the user a screenshot | `SendUserFile` | Save it in the repo and give the path |
| Ask a multiple-choice question | `AskUserQuestion` | Ask in plain text with numbered options |
| Read an email code | Gmail connector | Any Gmail connector or app you have, otherwise ask the user for the code |
| Add a permission rule | `update-config` skill | Codex approval settings in `~/.codex/config.toml` |

Secrets are environment variables either way: Claude Code cloud environment settings, or your shell / Codex environment.
