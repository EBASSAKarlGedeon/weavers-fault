# janitor_field_diff.dart

- **Path:** `C:/Users/Gedeon/Documents/Coding/Glaze-stable/lib/features/catalog/services/janitor_field_diff.dart`
- **Lines:** 276 (read in one pass to the final line; file ends with `withoutInjected`)
- **Role:** Recovers lorebook text that JanitorAI injected *inside* the character's own prompt fields (persona, scenario, example dialogue, first message) by diffing a captured AFTER snapshot against a probe BEFORE snapshot and against the public catalog definition.

## Purpose

`janitor_separate.dart` isolates only what sits *outside* the `<...Persona>` / `<Scenario>` / `<Example…>` wrapper blocks: it drops those blocks whole, so anything a lorebook wrote **inside** them is lost. JanitorAI lorebook entries carry a `placement` (`default` / `personality` / `scenario` / `example_dialogs`) and a `placementPosition` (`before` / `after`); anything but `default` writes the entry into that field instead of adding a block of its own. The first message never even reaches the separator — it is an assistant turn, not part of the system message.

The recovery is a **diff, not a guess**, and it is deliberately two-pass:

1. **Pass one (trigger diff).** Every capture sends two messages: a bare `"."`, then the real trigger text (see `captureGenerateAlpha`). The first assembles a prompt with almost nothing fired — a BEFORE snapshot — the second an AFTER. Whatever is in AFTER but not in BEFORE was injected by the entries the trigger fired, wherever it landed.
2. **Pass two (always-on diff).** Compare the BEFORE snapshot against the character's **public catalog fields**, to catch entries that are always on: those fire in both snapshots and therefore cancel out of pass one. This pass needs a public definition and is skipped for a closed card — there is no clean baseline, and every guess would be indistinguishable from the card itself.

The library header states the design intent explicitly: an always-on entry the second pass cannot reach is **left where it is, inside the imported card** — "text that is in the prompt on every single turn is part of the character in everything but name, and reads that way in the card. Only the entries that come and go with the keys are worth recovering as a lorebook."

No Flutter/IO imports (only `library;` + `import 'janitor_separate.dart'`), so it is deterministic and unit-tested.

## Behaviour walkthrough

**`enum InjectionField { persona, scenario, example, firstMessage }`** — the four injectable fields of one assembled prompt (or of the clean catalog metadata the prompt was built from). Note `persona` here means the **card** persona (`<{{char}}'s Persona>`), not the user persona.

**`PromptFields`** — immutable holder `{persona, scenario, example, firstMessage}`, all defaulting to `''`, plus `static const empty`.

- `PromptFields.fromPayload(payload, {restore})` reads each field from a captured `generateAlpha` payload via the separator's extractors: `extractCard(payload)`, `extractScenario(payload)`, `extractExample(payload)`, `extractFirstMessage(payload)`. `restore` is applied to **every** field as it is read — pass the extractor's macro restoration so captured text (where JanitorAI already expanded `{{char}}` into the real name) lines up with catalog metadata, which still carries the macros.
- `PromptFields.fromMeta(meta)` builds the clean baseline from `/hampter/characters/{id}`: `persona` ← `personality`, `scenario` ← `scenario`, `example` ← `example_dialogs` ?? `mes_example`, `firstMessage` ← `meta['first_message']` plus **every** element of `meta['first_messages']` (strings only), non-empty ones joined with `'\n'`. Every greeting is folded into one field on purpose: the comparison is by line, so which greeting the captured chat opened with does not matter. `meta == null` → `empty`.
- `operator [](InjectionField)` and `isEmpty` (true when all four trim to empty).

`fromMeta`'s doc records the trap: a closed card returns empty fields, and "the scan then skips rather than reading as 'everything was injected'".

**`InjectedBlock`** = `(field, text)`; **`InjectionScan`** = `List<InjectedBlock> blocks` with `none`, `isEmpty`/`isNotEmpty`/`length`, `fields` (a `Set<InjectionField>` of the blocks present) and `text` — the recovered text joined with `'\n\n'`, **unlabelled** on purpose: "the build prompt reads this as entry bodies, and would cheerfully emit a '(from scenario)' label as if it were content — provenance stays on the blocks, for the UI to show."

**`_fold(String)`** — the comparison basis. Case-, whitespace- and glyph-insensitive:

```
.replaceAll(RegExp(r'''['‘’ʼ]'''), "'")
.replaceAll(RegExp(r'["“”]'), '"')
.replaceAll(RegExp(r'[-–—]'), '-')
.replaceAll(RegExp(r'\s+'), ' ')
.trim()
.toLowerCase()
```

It folds exactly the quote/apostrophe/dash variants `loosePattern` tolerates, because "the server rewrites those freely between one assembled prompt and the next".

**`_residue(after, before)` → `List<String>`** — the core primitive.

- Empty trimmed `after` → `[]`.
- Build `known` = the folded non-empty lines of `before`.
- Walk `after.split('\n')`: if the folded line is non-empty **and** is in `known`, call `flush()` (close the current block); otherwise append the raw line to the current block.
- `flush()` joins with `'\n'`, trims, and only emits when `_fold(text).length >= _minInjectionChars` (`24`).

It is deliberately a **line-set subtraction, not a positional diff**: an injection lands *inside* the field, splitting the baseline around it, so matching the baseline as one contiguous run would fail exactly when it matters. Blocks break wherever a baseline line was dropped, which is where the injection ends.

Two consequences to keep in mind when porting: (a) any injected line that happens to be byte-identical (after folding) to some baseline line cancels out silently; (b) reordering is invisible — only set membership matters, so a moved paragraph is not reported.

**`_minInjectionChars = 24`** — shortest block worth reporting, measured on the **folded** text. Rationale: injected lore is a sentence or more; anything shorter is punctuation, a stray heading or a line that drifted past the comparison, and "reporting it as an entry is worse than dropping it".

**`scanInjectedFields(...)`** → `InjectionScan`. Parameters: `required PromptFields capture`, `extraCaptures` (default `[]`), `probe`, `clean`, `publicContents` (default `[]`), `existing` (default `''`). If **both** `probe` and `clean` are null → `InjectionScan.none` ("every candidate would be indistinguishable from the card").

Setup: `seen = <String>{}` (dedupe across passes) and `alreadyIsolated = _fold(existing)`.

`collect(field, after, before)` runs `_residue(after, before)` and for each block: `withoutPublicEntries(block, publicContents).trim()` (so a public book injected into the scenario is not handed back as closed-lorebook material), then skip if the folded result is shorter than 24, if `alreadyIsolated.contains(folded)` (text the separator already isolated is not reported twice — a **substring** test on the whole folded separated text), or if `!seen.add(folded)`.

Then, per field in `InjectionField.values` order:

- **Pass one:** if `probe != null`, for each `pass` in `[capture, ...extraCaptures]`, when `pass[field].trim().isNotEmpty` → `collect(field, pass[field], probe[field])`. So every extra capture (a follow-up pass after the lorebook cap was hit) is diffed against the **same** probe.
- `if (after.trim().isEmpty) continue;` where `after = capture[field]` — pass two is skipped when the *capture's* field is empty, even if the probe had content.
- **Pass two:** `baseline = clean?[field] ?? ''`; only when `baseline.trim().isNotEmpty` → `collect(field, probe?[field] ?? after, baseline)`. An empty clean field is explicitly **not** a baseline: "treating '' as 'nothing was there before' would report the entire field as injected lore."

Returns `InjectionScan(blocks)` in field order, blocks in document order within each field/pass.

**`withoutInjected(text, field, scan)` → `String`** — removes what the scan reported from the card field it came from, because "what the scan reports goes into the lorebook, so it has no business staying in the imported card as well — the entry would reach the prompt twice, once always-on". Implementation: build a folded set of every line of every block whose `block.field == field`; if empty or `text` is empty, return `text` unchanged; else keep only lines whose fold is **not** in the set, join with `'\n'`, collapse `RegExp(r'\n{3,}')` to `'\n\n'`, trim. Matching is by line (not by block) because the blocks "may have had public-lorebook text cut out of them since, so a match on the whole block would miss".

## Data shapes

```
InjectionField (enum)  persona | scenario | example | firstMessage
PromptFields          { persona, scenario, example, firstMessage }   // all String, default ''
InjectedBlock         { InjectionField field; String text }
InjectionScan         { List<InjectedBlock> blocks }
```

Payload inputs are `Map<String, dynamic>` `generateAlpha` payloads: `messages` list of `{role, content}`; role `system` carries the wrappers, the first role `assistant` message is the greeting. Meta inputs are the `/hampter/characters/{id}` map: `personality`, `scenario`, `example_dialogs`, `mes_example`, `first_message`, `first_messages`.

## Network / WebView contract

None. This file performs no I/O and reads no DOM; it is pure functions over already-captured payloads. The two payloads it needs come from `JanitorWebViewProxy.captureGenerateAlpha` (a `"."` send and a trigger send); the meta comes from `janitor_provider.janitorFetchCharacterMeta`. Nothing is injected.

## Selectors, regexes and string literals

- Fold regexes: `'''['‘’ʼ]'''` → `'`, `'["“”]'` → `"`, `'[-–—]'` → `-`, `'\s+'` → `' '`.
- Block split / join: `'\n'` (line), `'\n\n'` (block join, and `InjectionScan.text`).
- Collapse: `RegExp(r'\n{3,}')` → `'\n\n'` (in `withoutInjected`).
- Magic number: `_minInjectionChars = 24`.
- Field names read from payload/meta: `messages`, `role`, `content`, `system`, `assistant` (via `janitor_separate.dart`), `personality`, `scenario`, `example_dialogs`, `mes_example`, `first_message`, `first_messages`.
- Doc-referenced JanitorAI literals: `placement` values `default` / `personality` / `scenario` / `example_dialogs`, `placementPosition` values `before` / `after`, and the probe body `"."`.
- No user-visible strings (provenance is kept on `InjectedBlock.field` and rendered by the UI; the related locale string is `catalog_lorebooks_injected_note` = `Includes {} fragment(s) recovered from the character's own fields — a lorebook wrote them into the scenario, the personality or the first message instead of adding them as entries.`).

## State machine, retries, timings

None — no timers, no retries, no state. Complexity is O(lines) per field per pass, with passes = `1 + extraCaptures.length` for pass one plus at most one for pass two.

## Errors and user-visible messages

No exceptions are thrown and no errors are reported. Degenerate inputs degrade to "nothing recovered": no probe and no clean baseline → `InjectionScan.none`; empty clean field → pass two skipped; short blocks → dropped. That is a silent-failure surface: a wrong baseline (e.g. meta restored from an edited card) yields an empty scan and the user sees only "No closed lorebook text was found." (`catalog_lorebooks_build_none`).

## Persistence

None.

## Porting notes for our SillyTavern port

- **Reproduce literally:** the fold table, the 24-char floor on folded length, line-set (not positional) subtraction, block breaking at every baseline-line hit, the `publicContents` subtraction inside each block, the substring dedupe against the separator's output, and the "no baseline → no report" rule.
- **Where it fits in our extension:** this is the only mechanism that recovers `placement: personality|scenario|example_dialogs` entries and first-message entries. Our ST-side equivalent has no `"."` probe send unless we add one — if we cannot afford two captures per card, this whole pass degrades to the pass-two (clean vs. probe) form only, which needs a public definition. Decide explicitly; do not silently drop pass one, because that is what recovers the keyed (non-always-on) entries.
- **Dart-only scaffolding:** nothing structural — this is nearly copy-pasteable JS. `PromptFields.fromPayload` depends on `janitor_separate.dart`'s extractors, which is where the porting risk actually sits.
- **Fragile / decisions:**
  - `alreadyIsolated.contains(folded)` is a substring test on a folded concatenation, so a recovered block that happens to be a substring of unrelated separated text is dropped (rare, but it is a false-negative path).
  - `if (after.trim().isEmpty) continue;` uses `capture`, not `probe`; a capture whose field came back empty but whose probe had content loses pass two for that field.
  - Line-level subtraction cannot see moved or duplicated lines, and re-inserts nothing if the injection replaced baseline text.
  - The baseline comes from `meta`, so an entry that is always on but whose text JanitorAI rewrites per-request (macros expanded, whitespace reflowed differently than `restore` reproduces) will not match and will be reported as injected lore — i.e. it will be duplicated into the rebuilt book *and* left in the card.
- **Suggested hardening for us:** normalise both sides through the same restore before folding (the code already allows it via `restore`, but `fromMeta` is fed raw macros), and prefer a multiset/positional-aware diff (LCS on folded lines) if duplicates are a real problem in practice.

## Open questions

- Whether the `"."` probe really produces "almost nothing fired" for always-on (`constant`) entries, or whether JanitorAI injects constant entries regardless of the message — the header asserts it ("those fire in both snapshots and so cancel out"), which implies constants DO fire on `"."`. Not verifiable from this file; `janitor_webview_proxy.dart:_captureLocked` (the two sends) plus a live capture would settle it.
- Whether `restore` is actually passed at the call sites (it is optional here) — UNKNOWN — not determined from this file; `widgets/janitor_lorebook_capture_sheet.dart` / `janitor_extractor.dart` would settle it.
- Whether `first_messages` can contain non-String elements that matter (the code filters `whereType<String>()`), i.e. whether greetings arrive as objects in some payloads — UNKNOWN — a live `/hampter/characters/{id}` response would settle it.
