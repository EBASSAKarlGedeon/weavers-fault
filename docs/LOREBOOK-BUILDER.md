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

## Limits

- A container whose rows are separated by blank lines instead of `---`/`###` would be split. The
  capture's containers all use markers; a different author's book is where this would surface,
  and the review table (P3) is where it gets caught.
- Titles for unanchored entries are cut at 60 characters and flagged; they are placeholders.
- No UI yet. The next steps are P3 (review table: entries, flags, rename/split/merge, then
  import), P4 (author keys from the capture's entry list) and P5 (provenance so a rebuild can
  update an existing book instead of duplicating it).
