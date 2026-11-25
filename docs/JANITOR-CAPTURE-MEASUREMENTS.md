# JanitorAI prompt capture — measured behaviour (canary lab)

Everything below was **measured** against live janitorai.com on 2026-11-24 with the vault's own
capture route. Each claim names the fixture that produced it. Hypotheses that died are kept, with
the evidence that killed them, so they are not re-proposed later.

Canary setup: throwaway private card `Goofy Ahh Boy` (`4d4d5bb3-3365-4e28-b162-80e60c8beaa8`,
`showdefinition:false`, description `Your task is to roast the Hiro as far as possible.`, first
message `**Voice**: Wassup late ass dude`) plus one lorebook script (`b15c953b-4317-43cb-a7e8-
3b01bb444a46`) published and assigned to that card. Capture route:
`POST /api/weavers-vault/janitor/capture {id, lore:true}`.

## 1. How the region is assembled

**M1 — the lore region is a blank-line-separated list of raw entry bodies.** Measured on every
fixture. The region contains no titles, no keys, no ids, no per-entry marker of the site's own:

```
BB01> constant entry, always spliced. BB01<

BB02> ## Alpha heading

first paragraph of BB02.

<b>bold tag</b>
===
second paragraph of BB02. BB02<

BB03> recursion hop one: the token zorbatrix lives here. BB03<
```

The separator between two entries is exactly `\n\n`. A blank line *inside* an entry is therefore
byte-identical to a separator.

**M2 — entry bodies are spliced verbatim.** Every byte of every fixture body appeared unchanged:
markdown headings, HTML tags, `===` lines, blank lines, trailing punctuation. Nothing is escaped,
normalised, trimmed or re-wrapped. This is what makes mechanical acceptance possible in the
rebuild: an entry either appears in the capture byte-for-byte or it does not appear at all.

**M3 — constants fire on every send, keyed entries only on a key match.** Fixture `ZZ01`
(`constant:true`, no keys, 52 chars) appeared in the `.` probe send and in the trigger send.
Fixture `ZZ03` (key `the`) appeared only when the message text contained `the`. With no constant
entry in the book (`CC`/`P`/`Q` fixtures) the `.` probe carried `probeSystemChars: 135` — the base
system prompt alone, zero lore.

**M4 — the trigger message is the card's own text plus greetings.** From
`src/endpoints/weavers-vault-janitor-capture.js:731`, `trigger = rawCard + triggerText + greetings`
joined by `\n\n`; `triggerText` is empty because the route does not pass it. Consequence: the keys
that can fire are exactly the words present in the card text — which is why `roast` (description)
and `hiro`, `dude`, `wassup` (first message) fired, and `hollowmere` never could.

**M5 — key matching is ordinary word matching, and short keys work.** `the` (3 chars) fired on a
message containing `the`. Common-word keys therefore over-fire: any entry keyed on a stop word is
injected into essentially every send, which both inflates the region and hides weaker matches.

**M6 — there is no single-hop recursion.** `BB03` (key `hiro`, active, body contains the token
`zorbatrix`) did not activate `BB04` (key `zorbatrix`). Follow-on activation from entry content does
not happen within one send.

## 2. What the site does NOT limit (all measured)

| Fixture | Entries | Total lore chars | Result |
|---|---|---|---|
| 10 short entries (`CC01`..`CC10`, 15 chars each) | 10 | 188 | all 10 spliced |
| 12 entries of exactly 200 chars (`P01`..`P12`) | 12 | 2,422 | all 12 spliced, each exactly 200 |
| 1 x 4,000 chars (`Q00`) + 20 x 600 chars (`Q01`..`Q20`) | 21 | 16,040 | all 21 spliced, nothing truncated |
| 60 entries of exactly 1,000 chars (`R00`..`R59`) | 60 | 60,178 | all 60 spliced, nothing truncated |

**M7 — no entry cap below 21.** Twenty-one entries arrived in one prompt.

**M8 — no per-entry truncation at 4,000 chars.** `Q00` was 4,000 chars and arrived complete: its
closing sentinel `Q00<` was present. A 500-word entry (~3.3k chars) is therefore safe on this axis,
even though the Fate books average ~670 chars per entry.

**M9 — no global budget at 16,040 chars (~4k tokens).** The whole 16k region landed in one system
message (`triggerSystemChars: 16175`). Whatever the real ceiling is, it is not small: the per-probe
batch can hold dozens of realistic entries, so the coverage loop is not forced into one-entry
probes.

**M11 — no budget at 60,178 chars (~15k tokens) either.** The `R` fixture spliced all 60 entries in
one system message (`triggerSystemChars: 60313`). The region held 60 blocks of 1,001 chars; the
first (`R00`) and the last (`R59`) were both complete, closing sentinel present, so nothing was
trimmed at either end. The binding constraint is therefore the chat's own context window, not a
lorebook budget — a book of realistic 500-700-char entries can be probed in batches of ~50-100.

## 3. The defect this exposed in our own counter

**M10 — `closedLoreEntries` over-counts whenever an entry contains a blank line.** The `BB` region
held 5 real entries and the report said `closedLoreEntries: 7`: the separator splits the region on
`\n\n`, and `BB02` contributed two extra splits. Symptom → cause → rule, for
`PITFALLS.md` when the counter is next touched: the region carries no entry ids, so a count derived
from blank lines is an estimate, not a measurement; anything that needs an exact count must reconcile
against the OCR/LLM segmentation, and the number must not be reported as exact.

## 4. Hypotheses that died here

**H1 (dead) — "the site caps the splice at 5 entries".** It looked true: the `BB` run spliced 5
entries and silently dropped the constant `ZZ01`. The real cause was the import, not a cap.

**H2 (dead) — "the import appends entries to the book".** It replaces them. Evidence: after
importing `CC01`..`CC10` over a book holding `ZZ`+`BB` entries, the book contained exactly the 10
`CC` entries (`BB`/`ZZ` grep count 0); importing `P01`..`P12` next left exactly the 12 `P` entries;
importing `Q00`..`Q20` next left exactly the 21 `Q` entries. The original auto-created "(no keys)"
entry is replaced as well. This single fact explains every "cap" observation above and retires it.

## 5. Consequences for the closed-lorebook rebuild

1. **Segmentation is inherently ambiguous.** Entries have no ids and internal blank lines are
   preserved, so splitting on `\n\n` is only a heuristic. Any rebuild must resolve boundaries by
   content (an LLM pass that respects markdown structure), and must not claim an exact entry count.
2. **Every entry body we emit is verifiable.** Acceptance can be mechanical: the body must appear
   verbatim in a capture where its key fired.
3. **Batching is viable, and the batch is large.** At least 60 entries / 60k chars per probe, with
   no truncation at either end. A 300-entry Fate book could be *seen* in ~5 probes if every key
   fired at once; the real cost is key coverage, not the splice.
4. **Key choice is the limiting factor, not the budget.** The trigger message is the card text plus
   greetings, so keys that do not occur in the card text can never fire until the capture learns to
   send a caller-supplied message (`triggerText` is already threaded into `captureJanitorCard` but
   never passed by the route). That pass-through is the first prerequisite for real coverage work.
5. **Stop-word keys pollute the region.** A book with keys like `the` injects that entry every send;
   coverage logic must treat a saturated probe's absence as censored, not as negative.

## 6. Open questions (next probes)

- Where is the real ceiling? 60,178 chars is the largest measured splice. The next step would be a
  fixture that provably exceeds the chat window (e.g. 300k chars) to see whether the site trims the
  region, drops entries, or refuses the send.
- Does the region stay one block when a card has several attached books? Fate has five, and they
  all splice into the same prompt. Attribution turned out not to matter for rebuilding content (we
  want the entries, not the book they came from), but ordering and interleaving still need one
  measurement with two attached books.
- Does a *published* script behave differently from a draft? The first two captures were with an
  unpublished book and produced zero lore; both had an unattached book, so attachment — not
  publication state — was the cause. Publication is confirmed working; draft behaviour is untested.
- What does the site do with a single entry larger than the window (e.g. 200k chars)? Not tested;
  it would tell us whether oversized entries are dropped or truncated.

## 7. Recipe (reproduce in ~5 minutes, no UI clicking except two steps)

1. Open the book in Chrome on the vault profile:
   `chrome.exe --user-data-dir=data/_vault-janitor-profile --new-window https://janitorai.com/scripts/<id>/edit`.
   The vault launches it with `--remote-debugging-port=0`, so read the real port from
   `data/_vault-janitor-profile/DevToolsActivePort` (line 1) — not 9222.
2. Import entries without clicking: `DOM.setFileInputFiles` on the page's
   `input[type=file][accept=".json"]` with a SillyTavern-format world-info JSON
   (`{name, entries: {"0": {key:[], content, constant, order, ...}}}`). Import replaces the book.
3. Click `Publish` (the editor shows "Unpublished changes" until you do).
4. Close every Chrome process holding that profile — the capture launches its own instance and a
   locked profile makes it fail.
5. `POST /api/weavers-vault/janitor/capture {id, lore:true}` from the app tab, then read
   `report.closedLoreEntries` / `closedLoreChars` / `probeSystemChars` / `triggerSystemChars` and
   `lorebookText`.

Fixtures used here live in `data/_canary-*.json` (not committed).
