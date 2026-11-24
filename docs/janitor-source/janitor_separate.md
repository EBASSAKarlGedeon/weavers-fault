# janitor_separate.dart

- **Path:** C:/Users/Gedeon/Documents/Coding/Glaze-stable/lib/features/catalog/services/janitor_separate.dart
- **Lines:** 360 (read in full: 1-360)
- **Role:** Pure-Dart, no-Flutter, no-IO core that isolates the injected closed-lorebook text from one captured `/generateAlpha` payload, plus the text-cleaning primitives (public-entry subtraction, entry splitting, macro restoration, credit stripping) that the whole extractor depends on.

## Purpose

Port of the SillyTavern `janitor-lorebook` plugin's `separate.cjs`. The file states the prompt layout it assumes, verbatim, in its library doc comment:

```
[ jailbreak / system prefix ]            <- leading bracketed block(s)
<{{char}}'s Persona> ... </...Persona>   <- character card
<UserPersona> ... </UserPersona>         <- user persona
<Scenario> ... </Scenario>               <- scenario (optional)
<Example...> ... </Example...>           <- example dialogue (optional)
<triggered lorebook entries ...>         <- everything else (what we want)
```

Everything the closed lorebook wrote *inside* those wrapper blocks is deliberately lost here (that is `janitor_field_diff.dart`'s job); everything left over after strip + subtract is the lorebook text.

## Behaviour walkthrough

### Types

`RemovedBlock(label, text)` — a wrapper block removed from the system content, kept for diagnostics. `SeparationResult(systemContent, lorebookText, removed, entries)`.

`_norm(s) => s.replaceAll(RegExp(r'\s+'), ' ').trim().toLowerCase()` — the normalisation used for de-duplication and line matching.

### `getSystemContent(payload)`

Iterates `payload['messages']` and returns the first `m['role'] == 'system'` with a `String` `content`; `''` when absent. Note `if (msgs is! List) return '';` — a payload whose `messages` is a Map yields empty (no lore) rather than an error, so a malformed capture reads as "nothing captured".

### Regexes (commented as "ported verbatim from separate.cjs")

- `_leadingJailbreak = RegExp(r'^\s*(?:\[[^\]]*\]\s*)+')`
- `_personaBlock = RegExp(r'<[^<>\n]*?Persona>[\s\S]*?</[^<>\n]*?Persona>', caseSensitive: false)`
- `_scenarioBlock = RegExp(r'<Scenario>[\s\S]*?</Scenario>', caseSensitive: false)`
- `_exampleBlock = RegExp(r'<Example[^<>\n]*>[\s\S]*?</Example[^<>\n]*>', caseSensitive: false)`

Dart has no `/s` flag, hence `[\s\S]`. `Persona` is matched case-insensitively but the *tag name* is otherwise free-form (`<[^<>\n]*?Persona>`), which is how `<{{char}}'s Persona>` and `<UserPersona>` both hit.

### `stripWrappers(text)`

Returns `({String out, List<RemovedBlock> removed})`. Ordered passes, each appending to `removed` and replacing the block:

1. `replaceFirstMapped(_leadingJailbreak, ...)` → `''`, label `'jailbreak'`, only if the trimmed match is non-empty. Only the **first** bracketed run at the very start is removed (one call).
2. `replaceAllMapped(_personaBlock, ...)` → `'\n'`. Label is `'userPersona'` when `RegExp(r'^<\s*userpersona', caseSensitive: false).hasMatch(block)`, else `'card'`. Order matters: the card block is removed before the user persona, and both use the same pattern.
3. `replaceAllMapped(_scenarioBlock, ...)` → `'\n'`, label `'scenario'`.
4. `replaceAllMapped(_exampleBlock, ...)` → `'\n'`, label `'example'`.

### `_subtractKnownCard(text, knownCard)`

Line-set subtraction of the card from the residue (belt-and-braces for card text that survived wrapper stripping). Builds `known` from `knownCard.split('\n')` keeping `_norm(line).length >= 12`; walks `text` lines, and any line with `_norm` length `>= 12` present in `known` is moved to `removed` instead of `kept`; the rest are re-joined with `'\n'`. The 12-char floor is what stops short shared phrases (`"He nods."`) from deleting lore.

### `loosePattern(needle)`

Public, because `janitor_field_diff.dart` matches the same server-rewritten text. Escapes regex metacharacters first (`. * + ? ^ $ { } ( ) | [ ] \`), then:

- whitespace run → `\s+`
- `['‘’ʼ]` → `['‘’ʼ]` (straight + curly + modifier apostrophes interchangeable)
- `["“”]` → `["“”]`
- `[-–—]` → `[-–—]`

Everything else matches literally. Escaping happens **before** the class substitutions, so the substituted classes survive.

### `_stripPublicEntries(text, publicContents)`

For each content: `needle = content.trim()`; skip when `needle.length < 12`; build `RegExp(loosePattern(needle), caseSensitive: false)` inside a `try` (an un-compilable pattern ⇒ `continue`, silently skipping that entry); `replaceAllMapped` the whole match with `'\n'` and record the match. Public entries that never fired are simply not found — no error.

### `_tidy(text)`

`[ \t]+\n` → `\n` (strip trailing spaces), `\n{3,}` → `\n\n`, `trim()`. This is the canonical whitespace shape of all lorebook text in the pipeline.

### `withoutPublicEntries(text, publicContents)`

`publicContents.isEmpty ? text : _tidy(_stripPublicEntries(text, publicContents).out)`. Exposed for text isolated *before* the public entries were known (a public JS script converted after capture) and for the field diff, which subtracts them from every block it recovers.

### `splitEntries(text)`

`text.split(RegExp(r'\n\s*\n')).map(trim).where(non-empty).toList()` — entry boundaries are blank lines (a blank line with trailing spaces counts).

### `mergeLorebookTexts(texts)`

Dedupes entries across capture passes by `_norm(block)`, keeping first-seen order, joining with `'\n\n'`. Rationale in comment: split-trigger passes fire overlapping entry sets and the server assembles an entry identically whichever pass fired it, so block-level identity is sufficient.

### Field extractors (all read `getSystemContent` only)

- `extractCard(payload)`: `RegExp(r'<([^<>\n]*?)Persona>([\s\S]*?)</[^<>\n]*?Persona>', caseSensitive: false)`, iterating `allMatches` and **skipping** any whose group 1 matches `RegExp(r'^\s*user', caseSensitive: false)`. Returns `m[2]!.trim()` — the first non-user persona inner text, `''` otherwise.
- `extractCharName(payload)`: first `<([^<>\n]*?)Persona>` (ci), strips a trailing possessive with `RegExp(r"['’]s\s*$", caseSensitive: false)`, trims, and returns it unless `.toLowerCase() == 'user'`.
- `extractScenario(payload)`: `<Scenario>([\s\S]*?)</Scenario>` (ci), group 1 trimmed.
- `extractExample(payload)`: `<Example[^<>\n]*?>([\s\S]*?)</Example[^<>\n]*?>` (ci), group 1 trimmed.
- `extractFirstMessage(payload)`: first `role == 'assistant'` with a `String` content, trimmed; this is the assistant turn of the captured prompt, i.e. the opening line.

### `restoreMacros(text, {charNames, userName})`

`const int _minMacroNeedle = 3;` — "A one- or two-letter name matches everywhere and would shred the text." `charNames` are trimmed, filtered to `length >= 3`, de-duplicated via a `Set`, converted to a list and **sorted longest-first** (so `"Anna Lee"` is swapped before `"Anna"`), then `out.replaceAll(name, '{{char}}')`. Then, if `userName.trim().length >= 3`, `replaceAll(user, '{{user}}')`. Empty input returns unchanged. Note: plain `replaceAll`, so these are literal, not word-bounded — a name that is a substring of an ordinary word will be mangled (an accepted risk, gated only by the 3-char floor).

### Credit stripping

Two regex sources, documented as matching `created by {author} 2026© on janitorai.com`:

```
const String _creditCore = r'created[ \t]+by[ \t]+[^\n]{1,120}?[ \t]+on[ \t]+'
    r'(?:https?://)?(?:www\.)?janitor\.?ai(?:\.com)?\b/?';
const String _creditDecor = r'[\[\]()*_~|>\-–—.! \t]*';
```

- `_creditLine = RegExp('^$_creditDecor$_creditCore$_creditDecor(?:\\r?\\n|\$)', caseSensitive: false, multiLine: true)` — the credit alone on its line (plus markdown/bracket decoration), removed together with the line break.
- `_creditInline = RegExp('[ \\t]*[\\[(*_~]*[ \\t]*$_creditCore[\\])*_~]*[.!]?', caseSensitive: false)` — the credit appended to or embedded in a line of real text.

`stripJanitorCredit(text)` short-circuits on empty input or when `_creditInline` does not match, then `_tidy(text.replaceAll(_creditLine, '').replaceAll(_creditInline, ''))`. It never crosses a line break ("so it cannot swallow the text around it"), and the domain pattern tolerates `janitor.ai`, `janitorai.com`, `janitor.ai.com`.

### `separate(payload, [knownCard = '', publicContents = const []])`

The pipeline, in order:

1. `systemContent = getSystemContent(payload)`
2. `a = stripWrappers(systemContent)`
3. `b = _subtractKnownCard(a.out, knownCard)`
4. `c = _stripPublicEntries(b.out, publicContents)`
5. `lorebookText = _tidy(c.out)`
6. `removed = [...a.removed, if (b.removed.isNotEmpty) RemovedBlock('knownCard', b.removed.join('\n')), if (c.removed.isNotEmpty) RemovedBlock('publicLorebook', c.removed.join('\n\n'))]`
7. `SeparationResult(systemContent, lorebookText, removed, entries: splitEntries(lorebookText))`

## Data shapes

Input: `Map<String, dynamic>` with `messages: List<Map>` where each element has `role` (`'system'` / `'assistant'` / others) and `content` (`String`). Output: `SeparationResult`. All helper records are `({String out, List<...> removed})` tuples; `RemovedBlock.label` values in use: `'jailbreak'`, `'card'`, `'userPersona'`, `'scenario'`, `'example'`, `'knownCard'`, `'publicLorebook'`.

## Network / WebView contract

None. Explicitly "No Flutter / IO dependencies — this is the deterministic, unit-tested core."

## Selectors, regexes and string literals

All of the regex sources listed above, plus: `r'\s+'`, `r"['’]s\s*$"`, `r'^<\s*userpersona'`, `r'^\s*user'`, `r'[.*+?^${}()|[\]\\]'` (escape set), `r'\s+'` (whitespace collapse in `loosePattern`), `r'''['‘’ʼ]'''`, `r'["“”]'`, `r'[-–—]'`, `r'[ \t]+\n'`, `r'\n{3,}'`, `r'\n\s*\n'`. Magic numbers: `12` (minimum line/content length for subtraction, three places: `_subtractKnownCard` twice, `_stripPublicEntries` once), `_minMacroNeedle = 3`, `{1,120}` (credit author span). Label literals as above. Separator/joiners: `'\n'`, `'\n\n'`.

## State machine, retries, timings

None — pure functions. The only branching state is the public-entry loop, which silently skips short needles and un-compilable patterns.

## Errors and user-visible messages

No exceptions raised and no user-visible strings. The single `catch (_) { continue; }` around `RegExp(loosePattern(needle))` is the only error handling; it makes a pathological public entry quietly un-subtractable.

## Persistence

None.

## Porting notes for our SillyTavern port

Reproduce literally (this is the highest-fidelity file in the group — it is already a pure port and is described as unit-tested):

1. **Wrapper regexes and the `\n` replacement.** Replacing each removed block with `'\n'` (not `''`) is what keeps the residue from gluing two lore blocks into one entry.
2. **`_subtractKnownCard` and `_stripPublicEntries` 12-char floor.** Both have it; dropping it deletes short lore lines, raising it loses entries.
3. **`loosePattern` glyph classes.** Straight/curly apostrophes, straight/curly quotes and hyphen/en/em dash must be interchangeable; JanitorAI rewrites them between assembled prompts. In JS these become character classes with `u`-safe literals; the escape set is `. * + ? ^ $ { } ( ) | [ ] \`.
4. **`_tidy` order** (`[ \t]+\n` → `\n`; `\n{3,}` → `\n\n`; trim) and `splitEntries` on `\n\s*\n` — the "blank line = entry" contract that the LLM build step also assumes.
5. **`mergeLorebookTexts` dedupe key is `_norm(block)`** (whitespace-collapsed, lowercased whole block), preserving first-seen order.
6. **`extractCard` skips `<UserPersona>`** via `^\s*user` on the tag name — a card whose tag is literally `<User's Persona>` would be skipped (inferred: `^\s*user` matches the prefix).
7. **`restoreMacros` longest-first + 3-char floor, applied AFTER subtraction** in the extractor's `macro()` order (`restoreMacros(stripJanitorCredit(text), ...)`).
8. **Credit regex pair** including `_creditDecor`; the `[^\n]{1,120}?` lazy middle is what makes `(c)`/missing-year variants match without swallowing the next line.

Dart-only scaffolding: none of substance — the `library;` directive, record types, `const` constructors are language details. In JS, `replaceFirstMapped` becomes `String.replace(re, () => '')` with a capture-first trick, and the `({String out, ...})` records become plain objects.

Fragile / watch:
- `separate` is order-dependent on persona → scenario → example; a prompt where the example block wraps a persona block would lose the inner block silently.
- `_leadingJailbreak` only fires `replaceFirst`, so a second bracketed system block stays in the lorebook text.
- `extractFirstMessage` returns the *first* assistant turn; a chat with a system-injected assistant message before the greeting would return the wrong text (inferred).
- `loosePattern` escapes metacharacters but the substituted glyph classes introduce `-` inside `[-–—]`, fine, and `'` inside `['‘’ʼ]`, fine — but any future addition must stay inside a class.

## Open questions

- Whether `separate.cjs` (upstream JAR) used the same 12-char floors and `_creditDecor` character set — the Dart comments claim verbatim porting, but I did not read `separate.cjs` to confirm. `C:/Users/Gedeon/Documents/Coding/Glaze-stable` has no `separate.cjs`; the SillyTavern plugin source would settle it.
- Whether the server ever emits `<Example>` with a nested `<Scenario>`-looking line — not determined from this file; only real captured payloads would answer.
