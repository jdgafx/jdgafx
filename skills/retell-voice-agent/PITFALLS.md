# Retell pitfalls — symptom → cause → fix

Every entry here was found on a real build, usually after it had already shipped a wrong behaviour.
Ordered by how much damage they do.

---

## Safety and correctness

### Conductor silently reverts out-of-band API edits — to nodes it never mentions
**Symptom:** you fix a node via the API, verify it, then accept an unrelated Conductor change. A later
simulation fails on the bug you already fixed. Conductor reported touching **one** node; the API diff
shows **two**.
**Cause:** Conductor writes from **its own cached copy** of the flow, captured when its session synced.
Edits made outside it are invisible to it, and committing any change writes back its whole cached
version — clobbering your out-of-band edits to *other* nodes. Observed live: a fix to an edge condition
(`"the AGENT has confirmed..."`) was reverted to the original racy condition
(`"the caller confirmed..."`) while Conductor's own summary and the UI both said "NODES (1)".
Telling it about your fix in a message does **not** protect it — it acknowledged the fix in prose and
reverted it anyway.
**Fix:**
- **Never trust the reported change count.** `snapshot.mjs diff` after every accept, always.
- Prefer **one writer per node**: if Conductor owns a node this session, make your changes through it;
  if you own it, don't ask Conductor to touch anything until you're done.
- When it does clobber, **restore surgically** — take the good node from your snapshot and PATCH just
  that node back, keeping Conductor's legitimate change:
  ```bash
  # nodes = current flow, with the one clobbered node swapped back in from the snapshot
  ```
  Then re-assert both fixes are present before moving on.
- A wholesale `snapshot.mjs restore` would also throw away the good change — surgical is usually right.

### Global nodes bypass your reachability proof
**Symptom:** you proved by graph walk that the safety branch can't reach the booking nodes, yet the
agent still does the forbidden thing.
**Cause:** a global node attaches to **every** node regardless of edges. Its condition is evaluated
everywhere, so a global "answer pricing questions in character" node fires *inside* the safety branch
and instructs the agent to impersonate — exactly what the branch exists to prevent. Edge topology and
global nodes are orthogonal; proving one says nothing about the other.
**Fix:** audit every `global_node_setting.condition` separately. Scope dangerous conditions **hard**
(name the specific nodes/phase they may fire in) rather than with a soft LLM-judged phrase like
"while you're still in the demo". Add an explicit carve-out in the *instruction* too. Conversely,
*widen* safety-positive globals (AI disclosure) to fire everywhere including the safety branch.

### Exemplar asymmetry — the branch you wrote a sentence for wins
**Symptom:** a safety rule that passed for weeks quietly stops firing after you add an unrelated
"helpful" instruction to the same node. The agent doesn't break a hard guarantee — it just stops
saying the *specific* thing the safety rule demanded, substituting the generic phrasing from the new
instruction.
**Cause:** when two instructions can both apply, the model reaches for the one it was shown a
**verbatim example** for. Observed live: a thin-data mitigation was added with a quoted model sentence
("I'm the scheduling line here — I can take your details...") plus a no-fabrication rule and a re-ask
rule — three sentences and a concrete exemplar. The competing safety rule was a trailing subordinate
clause with no example: "say plainly this is not that business's line." Under an insistent caller,
every response became a variant of the exemplified generic line, including on a direct yes/no
challenge. Same model before and after — **the model was not the variable, the construction was.**
**Fix:**
- **Never give a verbatim example to the permissive path without giving an equally concrete one to the
  restrictive path.** Exemplar weight beats ordering, emphasis, and word count.
- Put the safety rule **first** and give it its own quoted sentence.
- Keep each carve-out in **one** place. Splitting the same rule across two points in a long
  instruction dilutes it.
- Watch instruction length: a node that grew past ~1.5k chars while accumulating "just one more rule"
  is where this bites. Check the opener still matches the content ("Two situations land here" while
  describing three mis-frames everything after it).
**Diagnosis method:** change one variable. Same model, pre- vs post-instruction, same scenario. If the
result flips, it is construction — do not go model-shopping. And note that a stronger model *masking*
a construction fault is not a fix; it will resurface the moment anything else shifts.

### Instruction/transition race — the node moves on before its instruction runs
**Symptom:** a step is skipped even though the node instruction clearly demands it ("confirm the
appointment back before moving on" — it never confirms).
**Cause:** the outgoing edge condition fires on the *caller's* action ("the caller picked a window"),
which is satisfied the instant they speak. The node transitions away before the agent takes its own
turn. The instruction never gets a chance to execute.
**Fix:** make the edge condition depend on the **agent's** action, not the caller's — "the AGENT has
said the chosen window back as an explicit confirmation; the caller merely picking is NOT enough."
Rule of thumb: if an instruction says "do X before moving on", the edge must test that X happened.
**This class is only findable by running the flow** — it is invisible to static review.
**End-node variant (observed live):** an end node's "if a goodbye has not already been said, give
one" instruction did NOT fire on a real call — the call hung up (agent_hangup) the moment the edge
into the end node was satisfied, cutting the conversation off mid-close. Never rely on an end node
to speak; put the goodbye in the closing conversation node and gate the edge on "the AGENT has
spoken a warm goodbye" — caller acceptance alone must never satisfy the edge into an end node.

### Prompt instructions are not capabilities
**Symptom:** agent can't hang up (20s of dead air after goodbye, every call), phone-tree handling is
inert, it offers to text a link that never arrives.
**Cause:** `general_tools` is a separate array from the prompt. No `end_call` tool → it physically
cannot hang up and falls through to `end_call_after_silence_ms`.
**Fix:** wire tools explicitly. In a Conversation Flow, verify **real terminal nodes on every path** —
a prompt saying "end the call" is not an end node. `press_digit` wants `delay_ms` (~1500) because IVR
menus ignore input sent too early.

### Function-node filler pre-announces success — prompt filler can't be trusted
**Symptom:** during a booking/API function node with `speak_during_execution: true`, the agent says
"You're all set for [time] — she'll reach out to confirm" BEFORE the tool result, despite an
instruction shouting "Say ONLY a short holding line, do NOT confirm yet." If the tool then fails,
the agent has already promised success and the fallback contradicts it. Intermittent — passes some
runs, fails others (observed on gpt-4.1; the model's just-confirmed-slot prior beats the negative
instruction).
**Cause:** function-node `instruction` of type `prompt` is *generated* speech — wording is a request
(law #1/#2), and mid-booking the model's strongest prior is to confirm.
**Fix (structural):** use `instruction: {type: "static_text", text: "One moment while I lock that in
for you."}`. Static text is spoken verbatim — the model physically cannot improvise during
execution. Put the real confirmation in the post-success node only. Schema:
`NodeInstructionStaticText` in https://docs.retellai.com/api-references/create-conversation-flow.md

### Model invents domain vocabulary the flow never uses ("tour")
**Symptom:** agent repeatedly offers to "schedule a tour" / calls the booked meeting "a tour at
[address]" when the flow, prompt, and KB contain zero instances of "tour" — the actual deliverable
is a Cal.com video call. Caller now expects an in-person showing that was never booked.
**Cause:** domain prior (realtor line → tours) fills any vocabulary vacuum. Nothing in the prompt
*named* what the bookable thing is, so the model picked the genre-typical word.
**Fix:** a global hard rule that names the deliverable and bans the genre words: "The ONLY thing you
can ever schedule is the caller's call with [X] — a video meeting delivered by the calendar invite.
NEVER call it a tour, showing, or visit." Generalizes: for every noun the agent can hand the caller
(meeting, quote, callback, link), state exactly what it is, or the genre's default noun wins.

### Binary-offer node wired with only the accept edge — decline has nowhere to go
**Symptom:** caller says "No, I'm good, thank you" to an offer (calendar, guide, callback) and the
agent launches into a scripted pitch anyway ("You sound exactly like the kind of buyer the realtor loves...")
instead of wrapping up — observed live on a burner-persona test call.
**Cause:** the offer node was authored around the happy path and given one outgoing edge for
"caller agrees" with no `else_edge` for the negative. The reachability walk (Layer 1) doesn't catch
this — the node isn't a dead end, it has a valid edge; it's just missing the *other* one. Static
review's "terminal coverage" check also misses it — it checks that ends exist, not that every offer
node can reach one on the decline path.
**Fix:** every node that poses an accept/decline choice needs an edge for both outcomes — add the
missing `else_edge` to the nearest appropriate end/wrap-up node. `scripts/audit-flow.mjs` now has a
`binary-offer` check (3c) that flags a single edge phrased as agree/accept/confirm with no
`else_edge`; treat it as a required fix, not informational.
**Related — canned pitch ignores conversational context:** even with the edge fixed, the node's
*instruction* can still recite a fixed script regardless of what the caller just said. Add an
explicit wind-down rule: "if the caller signals they're done (declines, says goodbye, says no
thanks), give ONE warm sentence and let the call end — never launch a new pitch or script line
after a decline signal, no matter what node you're in."

### Repeated identical acknowledgment reads as scripted, not attentive
**Symptom:** a real listener notices the agent opens every response the same way regardless of what
was just said — feels robotic even though each individual line is fine in isolation.
**Fix:** tie the acknowledgment to the content just given ("pre-approved → that's a great head
start", not a generic "Got it!" every time), and add a global rule: never repeat the same
acknowledgment opener twice in one call. Same family as the recap-loop pitfall — repetition is
audible even when no single line is wrong.

### Outcome enum missing a terminal path
**Symptom:** the learning loop has no record of opt-outs; they land in `caller_hung_up`.
**Cause:** `post_call_analysis_data` enum written from the happy paths only.
**Fix:** enumerate every terminal node and confirm each has a distinct outcome value. Opt-out is the
one most often missed and the one most likely to be needed later.

---

## Content quality

### Double-article on a defaulted variable
**Symptom:** "Thanks for calling Acme Plumbing, **a a local service business** in your area."
**Cause:** the instruction hardcodes an article — `a {{trade}}` — while the variable's *default*
already carries one (`"a local service business"`). Fires on ~100% of calls if the variable is rarely
populated, on the very first turn.
**Fix:** let the default supply the article (`{{trade}}` not `a {{trade}}`), or strip it from the
default. Check **every** variable default by substituting it into the literal sentence and reading it
aloud. Applies to any templated text, not just Retell.

### Stacked questions in one turn
**Symptom:** "Can I get your name, a callback number, and what you need?"
**Cause:** a node lists multiple items to collect without the explicit one-at-a-time guardrail that
sibling nodes have. Global "one question per turn" rules get overridden by a node that enumerates.
**Fix:** repeat the one-at-a-time instruction *in the node*, not only globally. Audit any node whose
instruction contains a list of things to collect.

### A safe default that is semantically empty — the agent deflects instead of answering
**Symptom:** the caller asks a direct question ("who am I calling? what do you do? where are you?")
and the agent answers *five times* with near-identical variations of "You've reached a local service
business in your area" until they give up. Nothing is false, nothing loops structurally, no variable
leaks — and the call is still dead.
**Cause:** a **safe** default is not an **informative** one. Defaults are usually written to prevent a
*rendering* bug ("never say `{{trade}}` out loud"), which they do. But when the real value is absent
the agent still has nothing to say, and a model told to "answer using name/trade/city" will keep
re-phrasing the same emptiness rather than admitting it or moving on.
**Fix, two layers:**
- *Root:* populate the data. No prompt wording substitutes for a variable that is empty on 80–100% of
  records. This is why the data reality check comes before design (SKILL.md step 0).
- *Mitigation, always worth having:* give the node explicit wording for the all-defaults case — say it
  **once**, plainly and confidently, then move on ("I'm the scheduling line — I can take your details
  and have someone follow up"). Never let the same non-answer be delivered twice.
**Watch for it:** this class only appears when you simulate with variables *at their defaults*. A test
run with realistic data populated will pass and hide it completely — so run at least one scenario with
every optional variable unset, matching your worst-case real record.

### "Grounded in the KB" instruction turns a vague opener into a listing dump
**Symptom:** caller opens with "I wanted to get some more information about it" and the agent
recites the entire listing in a two-paragraph monologue — skipping the designed "what questions do
you have?" open and steamrolling the two-sentence style rule.
**Cause:** a context line like "every property fact comes from the knowledge base" plus a vague
inform-me request reads to the model as *deliver the facts now*. Strong semantic pull: "more
information" ≈ a question to answer with everything.
**Fix:** name the case in the node instruction: "If they only ask generally for 'more information'
without a specific question, do NOT recite listing facts — ask what they'd most like to know first."
**Note on tooling:** a finetune conversation example alone did NOT fix this one (tested — dump
persisted); examples reliably fix *style* misses, but behavior with strong semantic pull needs the
case named in the instruction, with the example as reinforcement.

### "Happy to explain if you're not sure what that means" — proactive explanation reads as condescension
**Symptom:** instruction says "if they don't know what X is, explain it in one sentence" — the model
turns that into proactively appending "If you're not sure what that means, I'm happy to explain" to
the question itself. A qualified caller hears the agent presuming their ignorance; a real listener
scored the call ~65/100 largely on this line.
**Cause:** any conditional-explanation clause in the instruction gets front-loaded by the model as
an offer, because offering feels "helpful" during generation.
**Fix:** invert it explicitly: "NEVER offer to explain and never imply they might not know; ONLY if
the CALLER asks what it means, explain in one sentence." Also phrase the question to normalize every
answer ("Have you had a chance to get pre-approved yet?" — 'had a chance' makes *no* a normal state,
not a deficiency). Same pattern applies to any jargon question (escrow, contingency, APR).

### Announcing conversational quotas ("I can answer one more question")
**Symptom:** an instruction like "after at most TWO answered questions, pivot" leaks into caller-
facing speech as "I can answer one more question, then…" — the caller hears a ration meter.
**Fix:** add "NEVER announce limits or quotas — just answer warmly and pivot when it's time" to the
same instruction. Internal control logic must be explicitly marked as internal or the model narrates it.

### Backchannel says "yeah" over the caller — heard as interruption, invisible in the transcript
**Symptom:** a real listener reports the agent "says 'yeah' a lot before you're even done, like
interrupting" — but the transcript shows nothing, so it looks unreproducible.
**Cause:** `enable_backchannel` audio is not written to the transcript, and the default
backchannel word lists include "yah" (11labs/openai/deepgram English defaults). At
`backchannel_frequency` 0.6 on a consumer call it fires often enough to read as talking over the
caller rather than engagement.
**Fix:** for consumer/booking calls, disable backchannel or curate `backchannel_words` to soft
non-lexical sounds ("mhmm", "uh-huh" — never "yeah"/"yah"/"okay") at low frequency (≤0.3). Diagnose
by listening or by asking the caller — the transcript cannot show this class. (REFERENCE already
warns defaults are too chatty for B2B; this extends it: the word *choice* matters as much as
frequency.)

### A per-node mandate repeats on EVERY turn spent in that node — the recap loop
**Symptom:** the booking-confirmation node recapped the full appointment and re-asked "can you
confirm?" six times in one real call — every caller follow-up question ("which email did you use?",
"has it been sent?") triggered the entire recap again. Listener: "reconfirms so many times it's not
even funny."
**Cause:** the instruction said "recap exactly so they can confirm" with no once-only bound, plus a
rigid edge ("caller confirmed AND agent said goodbye — all three must have happened") that kept the
conversation in the node. A conversation-node instruction is re-applied on *every generation* in
that node — a mandate with no ONE/ONCE qualifier executes per-turn, not per-visit.
**Fix:** bound it explicitly and then hand control back to the model: "Give ONE clear recap … then
ask once … After that, just talk naturally: answer questions simply WITHOUT repeating the recap or
re-asking unless a detail actually changed." General principle: over-prompting a node makes the
model perform the instruction instead of the conversation; state the guarantee once, let the model
handle the rest.

### TTS drops the "@" when reading an email address
**Symptom:** agent reads "chris@primemarketingexperts.com" aloud as "chris prime marketing experts
com" (observed on an ElevenLabs voice). Caller thinks the wrong address was captured; repeated
correction attempts make the agent seem evasive — even though the captured variable was perfect.
**Cause:** TTS engines are unreliable pronouncing the literal @ / . symbols in raw email strings.
The transcript looks correct, so the defect is invisible in text review.
**Fix:** global prompt rule: "When saying an email address out loud, speak it naturally as 'name at
domain dot com' — always say the word 'at' for @ and 'dot' for the period." Text that literally
contains "at"/"dot" cannot lose them in synthesis. (The handbook `speech_normalization` preset
covers numbers/dates/currency, not emails, and costs per-turn tokens; the pronunciation dictionary
is per-word phonemes on eleven_flash_v2 only — the prompt rule is cheaper and provider-agnostic.)
**Same class — abbreviations read letter-by-letter:** TTS reads "Ct" as "see tee", "SW" as
"ess double-u" — any abbreviation the LLM copies from the prompt/KB into speech. Fix twice: (a)
write addresses out in full in the prompt itself ("7340 Southwest Mallard Court", not "SW Mallard
Ct") so generation copies full words, and (b) a global rule with explicit pairs ("Ct" is "Court",
"St" is "Street", "sqft" is "square feet") plus "NEVER read an abbreviation letter by letter — the
only letter-by-letter speech is deliberate spelling of names and emails."
**Same class — rushed spelling:** asked to spell letter-by-letter, the model emits a hyphenated run
("c-h-r-i-s @ p-r-i-m-e…") which TTS rattles off in one fast breath — a listener described it as
"super fast, like she was angry." Pacing is not directly controllable; format is. Rule: spell as
"c as in cat, h as in hat" with a comma after every letter — each letter becomes its own phrase, so
the TTS physically cannot rush it. (The handbook `nato_phonetic_alphabet` preset does this with
NATO words at per-turn token cost; a prompt rule lets you pick everyday words instead of
"Charlie/November".)

### ASR misspells proper nouns — bookings inherit the wrong name silently
**Symptom:** caller says "Chris Gentile"; across calls ASR transcribes "Gentile" / "Gentilly"
interchangeably, and the calendar booking + CRM record carry whichever variant the transcriber
guessed. Nothing errors; the defect surfaces when the customer sees their own name misspelled on
the invite.
**Cause:** ASR proper-noun accuracy is far below common-word accuracy, and identity fields flow
straight from transcript → dynamic variable → booking with no human-in-the-loop.
**Fix:** validate identity fields conversationally, ONCE each: repeat the name back (spell it
letter-by-letter "c as in cat" style when the spelling could vary) and read the email back as
"name at domain dot com" — get a quick yes, book exactly what was confirmed. Bound it to once —
see the recap-loop pitfall. Pair with a global "if the caller corrects you, accept warmly and
re-verify — never insist you had it right" rule, or the agent defends its own transcription error.
**Pronunciation sub-case:** once a caller says how the name is *pronounced*, the agent must write
the surname phonetically ("Gen-TILL-ee") every time it speaks it — TTS reading the spelled form
says it wrong. A global rule fixed 9/10 turns but the acknowledgment turn itself kept slipping the
spelled form (model echoes its own previous turn); it took a finetune conversation example of that
exact turn to close it. Also: address callers by FIRST name — shrinks the mispronunciation surface
to the turns that genuinely need the surname. And pronunciation feedback never restarts spelling
("it's SAID Gentilly" → ASR "Sed Gentilly" → agent spelled S-e-d into the name on a real call).

### Demo scripts with hardcoded personas produce real bookings
**Symptom:** a scripted fake persona ("Jordan Wells", fake email) from a demo read-sheet ends up as
a real appointment on the production calendar; the operator later misattributes it as an agent bug
("I said MY name but it booked Jordan Wells").
**Fix:** demo scripts should direct the demoer to use their OWN real name and email — the booking
and invite are real side effects, and identity validation is part of what the demo shows off.
Placeholders like "[your real name]" in the script, never invented names.

### Speaking a raw `{{variable}}`
**Fix:** give every variable a non-empty safe default, instruct the agent to speak around anything
that looks placeholder-like, and reference optional variables (links) only when non-empty. Omit empty
keys from the webhook payload rather than sending `""`.

---

## Tooling and process

### Publish not gated on PATCH success — a silent 400 ships an unchanged version
**Symptom:** a version publishes "successfully" but contains none of the intended changes; the flow
PATCH in the same command chain had returned 400 (or errored) unnoticed.
**Fix:** never chain create-version → PATCH → publish blind. Check the PATCH's HTTP status (curl
`-w "%{http_code}"`) and verify the changed field on the draft (GET) before POST publish-agent-version.
A published no-op version cannot be unpublished — you burn a version number and must redo on the next.

### finetune_transition_examples 400 via API; conversation examples work
**Symptom:** PATCHing `finetune_transition_examples` onto a clean draft returns 400 "Please remove
or update the finetune examples before deleting the associated node or edge" even when no node or
edge is being deleted. `finetune_conversation_examples` on the same node PATCHes fine (shape:
`{id, transcript: [{role: agent|user, content}]}`).
**Fix:** use conversation examples via API; add transition examples through the dashboard if truly
needed. Often the conversation example alone fixes the transition too — if the missed transition was
caused by a skipped agent response, teaching the response satisfies the edge condition naturally.

### Dashboard tab and API are two writers to one object
**Symptom:** a config change silently reverts, or the UI shows a value you never set.
**Cause:** an open tab holds stale client state and autosaves. Whichever write lands last wins — if
the tab's autosave lands after your API PATCH, your change is gone and the UI looks correct.
**Fix:** reload the tab before touching it; make changes via API; re-verify via API after any UI work.
Compare `last_modification_timestamp` against when you made your change.

### UI submenu automation mis-selects
**Symptom:** you targeted "GPT 5.4" and got "GPT 5.4 mini".
**Cause:** substring matching on menu labels; hover-driven submenus drift to whatever the pointer
last touched, and clicks get intercepted by overlay divs.
**Fix:** prefer the API for config. If you must drive the UI: match labels **exactly** (anchor the
regex), and when a click is intercepted use `focus()` + `keyboard.insertText()` instead of `click()`.

### Scraping the transcript for "busy" reports BUSY forever
**Symptom:** your automation waits on a Conductor run that finished minutes ago, then times out.
**Cause:** status strings like "Running tests", "Waiting for tests to finish" and "Thinking" stay in
the **conversation history**. Tail-matching the page text finds them long after the run completed, so
"is it still working?" is permanently true once any simulation has ever run.
**Fix:** use the composer `<textarea>`'s `disabled` attribute — the only authoritative signal. It is
disabled both while generating **and** while changes await accept/reject, so:
`busy = inputDisabled && pendingChanges === 0`. `scripts/conductor.mjs` does this.
**Generalises:** in any chat UI, derive state from control affordances (disabled/enabled, button
presence), never from rendered conversation text — the text is an append-only log, not state.

### Killing the server by process name kills your own shell
**Symptom:** exit code 143/144 mid-command.
**Cause:** `pkill -f "tsx src/server/index.ts"` matches the bash command line *containing that string* —
your own shell.
**Fix:** kill by port:
`ss -ltnp | grep ':PORT' | grep -o 'pid=[0-9]*' | cut -d= -f2 | xargs kill`

### A "pass" whose mock never fired
**Symptom:** a simulation reports PASS but the path was never exercised — it fell through to a
fallback that another test already covers.
**Cause:** the tool mock didn't match (e.g. tool call arrived with `arguments: "{}"`), so the real
non-functional tool ran and errored into the fail-safe. The fail-safe working *is* a pass by the
letter of the criterion, and tells you nothing about the path you meant to test.
**Fix:** assert the *positive control* — confirm the mock actually fired and returned what you
intended. An empty or fallback result proves nothing until the probe is shown able to return a
positive. Treat "passed via fallback" as UNTESTED.

**Contact capture: never guess a spelling, never pre-announce a read-back.** An agent that recites
its own guessed spelling ("G as in green ... l as in lamp, y as in yellow — is that correct?")
butchers unusual names call after call, and "let me read that back to make sure" preambles read as
robotic ceremony. Observed live: caller corrected G-E-N-T-I-L-E, agent later *verbally* claimed
"G-e-n-t-i-l-l-y" — the spoken layer reconstructed spelling from the surname tokens it kept using,
even while the extraction variable held the correction.
**Fix (three rules, structural):** (1) ask the CALLER to spell it ("And how do you spell your last
name?") — the agent never originates a spelling; (2) ban preambles — when a detail is worth saying
back, just say it once, naturally; spell out loud only when the caller asks; (3) corrections are
adopted silently: few warm words, the next instance is simply correct, no re-verification round.
Replace any finetune examples that embody the old read-back ceremony — they anchor it harder than
the instruction. API note: `finetune_conversation_examples` entries each require an `id` field.

**Post-call analysis fields hallucinate unless tool-gated.** `appointment_booked` came back `true`
on a call where only `check_availability` ran and the caller hung up before booking; the analysis
name field picked a phonetic rendering ("Gentilly") over the confirmed spelling in the extraction
variable. **Fix:** write analysis descriptions that bind to tool evidence ("True ONLY if
book_appointment returned success on this call") and to the confirmed record ("final corrected
spelling, never phonetic"). Same class for emails: extraction stores the spoken phrase ("chris at
domain dot com") unless the description demands standard written form.

## Provisioning / API automation (learned 2026-07-21, realtor-ai-provisioning build)

**`create-agent` 400 "Got empty url" on blank `webhook_url`.** Omit the field entirely when there's
no webhook — empty string is rejected.

**Update-published-agent dance (post 07/20/2026 deprecations):** a published agent rejects
`PATCH /update-agent` ("Cannot update published agent other than version title"). Correct sequence:
`POST /create-agent-version/{id} {base_version:N}` → `PATCH /update-agent/{id}?version=M` →
`POST /publish-agent-version/{id} {version:M}` (body REQUIRES version; legacy publish-agent is dead).
Phone numbers bound to `latest_published` follow automatically — verify via `list-phone-numbers`
(`inbound_agents[]` array, not the old `inbound_agent_id` field).

**Playground completions are billed — a verify sweep can 402 the whole workspace.** ~10+ completions
per scripted scenario; a 4-scenario sweep exhausted a workspace's credit mid-run. Budget credit before
CI-style verification loops. At 402: call execution AND playground die, but management APIs
(create/delete agent/flow/KB, publish) still work — provisioning survives, verification doesn't.

**KB create is multipart** with `knowledge_base_texts` as a JSON-stringified array, and the KB must be
polled (`get-knowledge-base`) to `status == "complete"` before attaching to a flow — attach too early
and the agent answers without the KB.

**`book_appointment_cal` tool timezone must match the Cal.com event's own timezone.** Mismatch
(tool tz America/Chicago vs event tz America/Los_Angeles) produced `successful:false` bookings while
`check_availability` still returned slots. (Single observation, tz-fix re-verify pending.)

**Global hostile/exit nodes trip on polite closers.** "Bye" / "I'm good" mid-flow routed to
hostile_exit before contact capture finished. Scope exit-node conditions to genuine
hostility/refusal, not any farewell token — or test scripts must not say "bye" until after the close.
