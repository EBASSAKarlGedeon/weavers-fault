# Lorebook builder — segmentation and gates

Status: P1 (segmenter), P2 (gates) and P2.5 (book assembly) are implemented as pure modules
with tests. Nothing is wired into the rebuild UI yet; the CLI below is the reference caller.

Code:

| File | What it does |
| --- | --- |
| `lorebook-segment.js` | deterministic boundaries: text → entries with offsets, titles, roles, flags |
| `lorebook-verify.js` | nine gates: the book must prove itself against the capture |
| `lorebook-build.js` | entries + World Info schema + keys → book, then runs the gates |
| `tools/rebuild-lorebook.mjs` | CLI wrapper, prints the report and exits 1 on a failed gate |

## Why a table of openers instead of a heuristic

The Fate Limitless capture (1,020,901 chars, 778 blocks) contains ten forms that actually start
an entry:

| Rule | Line | Role |
| --- | --- | --- |
| `servant-sheet` | `- Servant Name: X;` (dash optional) | sheet |
| `named-sheet` | `- Name: X`, **only after a blank line** | sheet |
| `topic` | `[System OOC]: This entry contains the information for X.` | topic |
| `deceased` | `[System]: This Entry contains information regarding the deceased characters…` | container |
| `present` | `[OOC]: The following Characters are present in the world/universe…` | container |
| `cities` | `[System]: This Entry contains information regarding other major cities…` | container |
| `other-characters` | `[System]: This Entry contains information regarding other major characters…` | container |
| `location-images` | `[System Inclusion]: … display the image of a location…` | container |
| `holy-church` | `[System]: This Entry contains information regarding the Holy Church…` | container |
| `concepts` | `[System]: This Entry contains information regarding concepts…` | container |

Everything else that looks like a header is a section and stays inside its entry:
`[Example Dialogues]:` (39×), `[Riding A+]:`, `[Extra Lore]`, `[Abilities]`, `[System]:` notes,
`[NOTE: …]`, `[Concept #N]` (N ≥ 2), `[---]`. A `- Name:` after `---`, `###` or `<[Name]>:` is a
container row, not an entry — that distinction is what keeps Present Characters (14,003 chars, six
sheets) in one piece.

## What the segmenter reports

Each entry carries `start`/`end` offsets into the normalised capture, `content` (exactly that
slice), `title`, `role`, `rule`, `confidence`, `flags` and `candidates`.

| Flag | Meaning |
| --- | --- |
| `leading-block` | text before the first opener was kept as its own entry |
| `low-confidence` | no explicit opener (text start, leading block) — review the boundary |
| `derived-title` | title cut from a paragraph; rename it |
| `multiple-sheet-blocks` | a sheet or topic holds more than one character sheet |
| `candidate-split` | a 60+ char bracketed paragraph, or a `[Title]:` header that is not a known section, may start an entry |
| `empty` | nothing to segment |

Flags are review items, not conclusions. On the Fate capture the segmenter produces 313 entries
(301 sheets, 7 containers, 4 topics) and 16 flags: the three genuine welds (Ozymandias in Medea,
Cleopatra and Bradamante in Van-Fem, ORT in Other Characters) are reported here, where the old
builder lost them silently.

## The gates

`verifyLorebook({ source, entries, authorKeys })` → `{ ok, failures, warnings, summary }`.
Failures block an import; warnings are review items.

| Gate | Code | Blocks | Catches |
| --- | --- | --- | --- |
| coverage | `offset-mismatch`, `overlap`, `uncovered-text`, `uncovered-tail` | yes | an entry that is not exactly its source slice, or text that fell between entries |
| coverage | `not-verbatim`, `no-offsets` | yes / warn | invented content in a book without offsets |
| foreign-opener | `foreign-opener` | yes | one entry holding another entry's opener |
| titles | `duplicate-title`, `title-mismatch`, `empty-title` | yes | two entries with one name; a sheet whose body names someone else |
| titles | `no-name-line`, `title-not-in-first-line` | warn | title hygiene |
| sheets | `multiple-sheet-blocks` | warn | welded second character sheet |
| keys | `missing-keys` / `author-key-missing` | yes / warn | untriggerable entry; author key not carried |
| macros | `malformed-macro` / `unbalanced-macro` | yes / warn | `{{{user}}}` |
| schema | `bad-field` | yes | missing `uid`, `key`, `comment`, `content`, `constant`, `position`, `depth` |

Separators between entries may be whitespace or empty `---` dividers; anything else is covered
text and fails the coverage gate.

## Assembly

`buildLorebook({ text, template, authorKeys, keysFor })` returns `{ book, report }` — the book is
a SillyTavern world file (`{ entries: { "0": {...} } }`), never returned without its report.

- Every entry gets the full field set (`keysecondary`, `selective`, `order`, `position`,
  `depth`, `probability`, …). `template` overrides the shared fields; `role` stays World Info's
  numeric injection slot, the segmentation label lives in `vaultRole`.
- Keys: `authorKeys` (keyed by lower-cased title) when the author's entry list is available,
  otherwise `defaultKeys(title)` — the whole title, its `/` parts, and the base name without a
  trailing `(Alias)`.
- `order` counts down from 100 so the book reads in capture order in the editor.

## Usage

```powershell
# whole pipeline, prints the report, exits 1 if a gate fails
node tools/rebuild-lorebook.mjs data/_fate-union.txt out.json [keys.json]
```

```js
import { buildLorebook } from './lorebook-build.js';
const { book, report } = buildLorebook({ text });
if (!report.ok) throw new Error(report.failures.map(f => f.message).join('\n'));
```

## Acceptance run (Fate Limitless)

| Measure | Result |
| --- | --- |
| Entries | 313 |
| Characters | 1,020,281 of 1,020,901 captured (620 are separators, mostly `---` dividers) |
| Sheets / containers / topics | 301 / 7 / 4 |
| Flags | 35 (3 real welds, 5 multi-form Servants, 9 bracketed paragraphs, 19 bracket headers, 1 derived title) |
| Known boundaries matched | 310 of 317 (the rest are the three welds and a `---` prefix) |
| Gate failures | 2 duplicate titles: Gilgamesh (two manifestations) and Clock Tower (two topics) |

Both duplicate titles are real: the first was resolved by hand as **Gilgamesh (Caster)**, the
second as **Clock Tower (Wandering Sea)**. The gate is doing its job.

## Second book, same author (Fate/Grand Order RPG)

Captured whole (no truncation): 139 blank-line blocks, 286,547 chars, `closedLoreEntries: 139` —
the same over-count as before, because a block is not an entry.

| Measure | Result |
| --- | --- |
| Deterministic entries | 16 (15 Servant sheets + the Grail War rules) |
| Characters covered | 286,517 of 286,547 (30 are separators) |
| Flags | 34: 24 bracket headers, 5 multi-sheet, 3 bracketed paragraphs, 1 derived title, 1 low confidence |
| Gate failures | 1 — two entries titled **Goetia** (the 22,011-char profile and the 3,712-char Servant sheet) |

This book is why the bracket header is a *candidate* and not a rule. It opens whole entries with
lines the Fate book uses for sections: `[Additional Staff List]:`, `- [Team A]:`,
`[Enemies Will ONLY Appear in their proper Singularities]:`, and one per Singularity
(`[First Singularity: 'City of a Thousand and One Lies' - NPCs]:`). The same syntax marks a section
inside a sheet (`[Example Dialogues]:`) and a section inside a container
(`[Miyama Town Location Images]:` in the Fate book). Syntax cannot tell them apart; the review
table is where the eleven structural splits get confirmed. A rule here would have split the Fate
book's Location Images entry into five.

## Review pass (P3)

The segmenter never guesses. Everything it cannot prove is a *candidate*, and a candidate is
only ever a suggestion until someone says yes:

    node tools/review-lorebook.mjs data/_go-union.txt data/_go-review.html

The page lists every entry with its title (editable), its flags, and its candidates with line
numbers. Tick `split before line N`, tick `merge up` where a split was wrong, fix the titles, then
download `decisions.json` and pass it along:

    node tools/rebuild-lorebook.mjs data/_go-union.txt data/_go-book.json - data/_go-decisions.json

`-` is the empty keys slot. Decisions are applied before assembly and re-verified, so a book that
was not `ok` can only become one by proving it:

| Grand Order | before review | after review |
| --- | --- | --- |
| Entries | 16 | **27** |
| Characters | 286,517 | 286,495 (22 separators) |
| Containers | 0 | 11 |
| Review actions | — | 11 splits + 1 rename |
| Gate | 1 duplicate title | **ok** |

The rename is the interesting one: two entries are literally titled **Goetia**, so one becomes
`Goetia (Servant)`. The body still says `- Servant Name: Goetia;` and stays verbatim, so the title
gate accepts a parenthesised qualifier and nothing else — the same trick the Fate book needed for
`Gilgamesh (Caster)`.

## Author keys (P4)

A closed Janitor lorebook arrives as text: no entry list, no ids, no keys. What the author did
publish is inside the text — a sheet declares its own `- Keywords:` and names its spirit, and the
author writes the variants they expect to trigger on:

    - Servant Name: Jingle Abel Meunière;
    - Keywords: "Meunière","Meuniere","Coffin Staff Officer",

    node tools/author-keys.mjs data/_fate-union.txt data/_go-union.txt --out data/author-keys.json

The store is keyed by normalised title, so it is a *library*, not a per-book artifact: a second
card by the same author that shares the servant sheets picks the keys up unchanged. Measured on
the two Fate books: the Fate store matches **12 of Grand Order's 27 entries by name** (the shared
Grail War rules entry plus eleven Servants).

| Store | Names | Keys | Sheets with declared keywords |
| --- | --- | --- | --- |
| Fate Limitless + Grand Order | 322 | 383 | 9 |

Harvesting also descends into containers: a `[Name: Kiara Sessyoin` row with its own Keywords line
becomes `kiara sessyoin => [Kiara Sessyoin, Dr. Kiara, Therapist Kiara]`, so when the review splits
that container the new entry inherits the author's keys instead of falling back to the title.

Keys follow the author when the store has them (title, slash parts and declared variants, all from
the store) and fall back to `defaultKeys` otherwise. A key two entries would both claim is reported,
not merged: `Caenis` vs `Caenis (Summer)` is the author having two sheets for one spirit, which is
the same collision the title gate rejects.

## Provenance (P5)

Every built book carries what it was built from, so a re-run can be checked against the capture
it claims and a fingerprinted review cannot drift unnoticed:

    "extensions": { "vault": {
      "version": 1,
      "tool": "weavers-vault/lorebook-build",
      "captureId": null,
      "source":  { "chars": 286547, "lines": 1773, "fingerprint": "646935d947960083" },
      "review":  { "fingerprint": "1e5aa3326fc77047", "renames": 1, "splits": 11, "merges": 0, "problems": 0 },
      "segmentation": { "entries": 16, "flags": 34 },
      "result":  { "entries": 27, "characters": 286495, "ok": true }
    } }

The fingerprint is FNV-1a 64-bit over the source text (pure, so the extension and the CLI compute
the same value): a content check, not a signature. `review.fingerprint` hashes the decisions with
sorted keys, so the same decisions always stamp the same value and any change to them is visible.
The CLI prints it as `fingerprint`.

`captureId` is null unless the caller passes one; the capture JSON has the card id, the `.txt`
does not, so the rebuild CLI cannot invent it.

## Limits

- A container whose rows are separated by blank lines instead of `---`/`###` would be split. The
  capture's containers all use markers; a different author's book is where this would surface,
  and the review table (P3) is where it gets caught.
- Titles for unanchored entries are cut at 60 characters and flagged; they are placeholders.
- No UI yet. The next steps are P3 (review table: entries, flags, rename/split/merge, then
  import) and P5 (provenance so a rebuild can
  update an existing book instead of duplicating it).
