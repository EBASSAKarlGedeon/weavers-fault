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

**M12 — a card's books concatenate into one region, grouped by book.** With two published books
attached to the same card (3 entries each, identical priorities), the region was `R01, R02, R03, S01,
S02, S03` — every entry of the first book, then every entry of the second, each group in priority
order. Six entries, 730 chars, no separator between the groups beyond the usual `\n\n`. So the
splice is not a global priority merge across books, and "which book did this entry come from" cannot
be read off the text; it only matters for mapping a rebuild back onto separate books.

**M13 — a caller-supplied trigger makes arbitrary keys fire.** `triggerText: 'wobble'` sent through
`POST /janitor/capture` activated the `S` entries, whose key appears nowhere in the card. The route
now forwards `triggerText` (capped at 20,000 chars) into `captureJanitorCard`, and the message is
built by the pure helper `janitorTriggerMessage` (card text, then the caller's words, then the
greetings). This is the prerequisite for coverage: keys can now be chosen instead of borrowed from
the card's own vocabulary.

## 2b. First capture of a real closed card (Fate Limitless, 2026-11-24)

Card `4dabfc73-a319-47aa-918a-52be90b828f9` — public, `showdefinition:false`, its five lorebooks all
published with `is_code_public:false` so the API returns `scripts:[]` and `script:null`. One capture,
no caller-supplied trigger (the default card-text trigger only):

| Field | Value |
|---|---|
| `descriptionChars` | 43,801 |
| `scenarioChars` | 22,587 |
| `exampleChars` | 62,192 |
| `alternateGreetings` | 5 |
| `closedLoreEntries` | **55 blocks** |
| `closedLoreChars` | **116,568** |
| `probeSystemChars` | 191,004 |
| `triggerSystemChars` | 248,394 |

**M14 — closed lorebooks are capturable on the real target.** The 116,568-char lore region is real
Fate material (Holy Grail War rules, a full Artoria Pendragon servant sheet with skills and a
Noble Phantasm) and it arrived without any trigger words beyond what the card itself contains.

**M15 — the block count is an upper bound on the entry count, and a loose one here.** Block sizes ran
from 102 to 14,028 chars, and many blocks end in `:` , `;` or `,` — mid-sentence. A 14k-char servant
sheet with markdown lists produces several blocks when split on blank lines, so the 55 blocks are
*not* 55 entries. This is the same defect as M10, now measured on real data: any rebuild has to
segment by content, and no count derived from blank lines may be reported as the entry count.

**M16 — a single send already carries ~29k tokens of lore.** 116,568 chars in one system message
(`triggerSystemChars` 248,394). The author of this card states the first book alone holds "over 129
entries", so one capture cannot be the whole book: coverage is not optional, and the natural page
size is whatever the chat window allows per send, with repeated probes for the rest.

## 2c. Coverage is additive, and the author published the key list

**M17 — the author's own keyword list is the coverage index.** The public page of the first book
(`https://janitorai.com/scripts/7ef92bc0-acdf-4d2e-9ee4-1cf9c716b388`) renders every servant as
`Name: [keyword, keyword, ...]`. Parsed from the rendered page text (the `/hampter/script/{id}`
record carries only the short blurb; the list lives in the page body): **334 rows, 996 keywords**,
59 class headers. That is the vocabulary a coverage pass should feed as `triggerText` — no guessing,
no vocabulary borrowed from the card.

**M18 — a keyword probe is additive: nothing is displaced.** Capture 1 (card text only) held 55 blocks
/ 116,568 chars. Capture 2 repeated the same card and added 20 servant keyword phrases (servants the
card never mentions: `Ibuki Douji`, `Kurohime`, `Bedivere`, `Suzuka Gozen`, `Kondou Isami`,
`Yamanami Keisuke`, `Barghest`, `Senji Muramasa`, `Chevalier d'Eon`, `Okita Souji`, `Saitou Hajime`,
`Miyamoto Iori`, `Sigurd`, `Richard I`, `Charlemagne`, `Gawain`, `Lancelot Saber`, `Siegfried`,
`Altera`, `Nero Claudius`). Result: **141 blocks / 184,096 chars**, of which **all 55 previous blocks
survived** and **86 were new**. `triggerSystemChars` 316,234 (~79k tokens) in one send.

So there is no cap at 55 and no eviction: selection is additive and key-driven, and the region grows
with the vocabulary in the message. Coverage is therefore a paging loop over the 996 keywords, with
the page size set by the chat window (~20-40 keywords per probe at ~3.4k chars of lore per keyword),
and it terminates when a probe adds nothing new.

## 2d. The full coverage pass on Fate (16 probes)

Keywords were taken from the author's own list (996 of them), batched 20-25 per probe, each probe a
fresh chat on the same card. New blocks per probe: 55, 86, 63, 66, 47, 75, 54, 55, 53, 52, 74, 60,
38, then **0, 0, 0** for the last three batches (53 servant names the union still did not contain).

| Measure | Value |
|---|---|
| probes | 16 |
| unique blocks in the union | **778** |
| unique chars | **1,020,901** |
| block size | min 3, median 720, p90 3,078, max 14,028 |
| blocks containing `Servant Name:` | **298** (297 distinct names, one repeat) |
| sprite image URLs (`ella.janitorai.com/media-approved/…`) | 194 |

**M19 — the attached set is ~300 entries and ~1M chars, and one pass gets it.** The 298 sheets
correspond closely to the 333 rows in the author's list (280 matched by name), and the last three
batches over every remaining listed name added nothing. So the union is the card's attached content,
not a sample: ~250k tokens of lorebook text behind a card whose definition field is 43,801 chars and
whose example dialogs are 62,192.

**M20 — entries are ~3.4k chars and carry images.** A servant entry is a wrapper plus a sheet
(`Servant Name:`, class, height/weight, alignment, appearance, skills, Noble Phantasm) plus sprite
blocks with markdown image links. That is why blank-line splitting shreds them into 2-3 blocks: the
sheet's own formatting *is* blank lines. Any rebuild has to segment on content (a `Servant Name:`
block starts an entry) and re-host 194 sprite URLs that currently point at the site's CDN.

## 2e. Rebuilding the capture into native world info

The 778 blocks split back into **316 entries** on line-start markers (`Servant Name:` or `Name:`, optionally
after a `---` or `###` line). Sizes: min 656, median 2,863, max 27,144 chars (the last one is Katya
Kambanellis plus the Clock Tower departments, one deliberately combined entry). Total 1,020,289 chars.

**Keys come from the author's list, not from guessing.** 295 of 316 entries matched a row of the
996-keyword table and took its keywords verbatim; 21 derived a key from their own name (the NPCs —
Rin Tohsaka, Shirou Emiya, Lord El-Melloi II, …). 895 keys in total, right-skewed to 2-4 per entry.

**A matching trap worth remembering.** Normalizing a name by *deleting* its parenthetical collapses
`Artoria (Summer)` to `Artoria`, which then matched the base `Artoria` **key** and handed the Summer
entry the Saber keywords. Rule: match strictly (parentheses preserved) first, then retry with
parentheses turned into word separators, and always eyeball a few variants of one family afterwards.
After the fix `Artoria Pendragon` → Saber keys, `Artoria (Summer)` → `Artoria Summer / Artoria (Archer)
/ Artoria (Summer)`, Lily and Lancer likewise.

**Topics were hiding inside sheets.** Segments between two sheets all ran into the entry before
them, so the Mage's Association (4,124ch), Atlas Institute (2,114ch), Clock Tower (10,602ch) and
the concept block (8,678ch: Mystery, Magecraft, True Magic, Magic Circuits, Vampires, Dead Apostles
with all eight ranks, Mystic Eyes, Noble Colors, True Ancestors) were welded onto Katya Kambanellis
as one 27k entry with Katya's keywords. Splitting at `[System OOC]: This entry contains the
information for …`, at `[Concept #1]`, `[Holy Church]:`, `[Other Locations]:` and the standalone
`[Abilities]:` block yields 323 entries / 1,020,277 chars / 939 keys, with the topic entries carrying
their own vocabulary (Concepts: Mystery, Magecraft, True Magic, Magic Circuits, Vampires, Dead
Apostles, Mystic Eyes, True Ancestors, Noble Colors). Content is byte-identical, only the grouping
changed.

**Provenance is asserted, not assumed.** Every entry's content is checked to be a contiguous substring
of the captured union (316/316 pass, 0 miss). Nothing was reworded, nothing invented.

Output: `data/default-user/worlds/Fate Limitless (Rebuilt).json` (1.54 MB), `position: 4` with
`depth: 10` — the depth the site itself reports in `settings: {"depth": 10}` — the Grail War Rules
entry `constant: true`, the remaining 315 keyed. Verified through `POST /api/worldinfo/get`: 316
entries, 1,020,289 chars.

**This is the answer to "the model cannot emit the JSON":** it never has to. The file is 1.54 MB and
was written by a script from captured text; the model's role is at most to write *keys* or *prose* for
entries that need it, a few hundred at a time.

Open: 194 sprite URLs still point at `ella.janitorai.com`; and how many entries fire per message is
now governed by the world-info budget (default 25% of context) exactly as the site's own selection
governed it.

## 2f. Cross-check against a live prompt (no keywords)

A real chat's system prompt was captured by hand (106,727 chars, persona plus card, no probe words)
and compared with our two artifacts. A scan every 2,000 chars says: 0-43k is the card description,
44k-106k is lorebook text, and **every 120-char window in the lore span is inside the 778-block
union** — nothing in that prompt was missing from the capture.

Where the sections live:

| Section | Home |
|---|---|
| `[Masters]`, `[NPCs]`, `[Alter-Persona]`, `[First Servant]`, `[Second Servant]`, `[OOC System]` | card description |
| `[Mystic Codes]` | split: description and a book entry |
| `[Other Locations]`, `[Abilities]`, `[Noble Colors]`, `[Example Dialogues]` | lorebooks |

This is the answer to "is the world of magi in there too": the world material is not one book, it is
the card's own description (masters, NPCs, mystic codes, the OOC frame) **plus** book entries
(locations, abilities, noble colors, rules). A rebuild that only ships the .json keeps the second half;
the first half is the character card's description, which was captured separately (43,801 chars).

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
- Does the *book* order follow attachment order, creation date or something else? Two books came
  out grouped in a stable order (R then S); with Fate's five it decides whether a rebuild can be
  split back into the same five books.
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
