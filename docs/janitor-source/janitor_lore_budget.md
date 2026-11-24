# janitor_lore_budget.dart

- **Path:** `C:/Users/Gedeon/Documents/Coding/Glaze-stable/lib/features/catalog/services/janitor_lore_budget.dart`
- **Lines:** 141 (read in one pass to the final line; file ends with `splitTrigger`)
- **Role:** Measures how much lorebook text JanitorAI actually injected into a captured `generateAlpha` payload (in `cl100k` tokens), decides whether that capture hit JanitorAI's lorebook cap, and splits an over-firing trigger into two balanced halves so the capture can be re-run.

## Purpose

JanitorAI applies a **server-side** cap while `/generateAlpha` assembles the prompt: once the triggered entries add up to it, the rest are silently left out. There is no error, no field, no marker in the response — a trigger that fires more than the cap simply loses entries. This file exists to (a) measure the lore text that came back, (b) decide whether it is close enough to the cap to count as cut off, and (c) provide a deterministic trigger-halving primitive so the caller can re-fire in smaller pieces and union the results.

It is also the only place in the extractor that counts tokens **the way JanitorAI counts them** rather than with the active connection's tokenizer.

## Behaviour walkthrough

**Constants**

```dart
const int janitorLoreTokenCap = 120000;
const int janitorLoreSaturationMargin = 8000;
```

`janitorLoreTokenCap` — "Most lorebook text JanitorAI injects into one assembled prompt, in tokens." `janitorLoreSaturationMargin` — how close a capture has to be to the cap to count as cut off. The doc gives the reasoning worth keeping: the server stops at the first entry that no longer fits, so a capped prompt lands *below* the cap by up to one entry; and the measure counts a little text around the entries that is not lore. A false positive costs one more pass, a miss loses entries — hence the generous margin. Effective threshold: `120000 - 8000 = 112000` tokens.

**`JanitorLoreBudget(this._count, {this.exact = true})`**

Holds a `int Function(String) _count` and an `exact` flag that is `false` when the vocabulary could not be loaded and `count` is "a deliberately high character estimate instead".

**`static Future<JanitorLoreBudget> load()`**

- Returns the memoised `_loaded` singleton if present — one load per process, never invalidated.
- Otherwise: `TokenizerStore(dataDir: await getAppDataDir())`, `await store.ensureCached(TokenizerKind.cl100k)` (downloads the vocabulary on first use if absent), then read `tokenizerCachePath(store.dataDir, TokenizerKind.cl100k)` = `'<dataDir>/tokenizers/cl100k.glztok'` as bytes and `decodeTokenizerCache(bytes)`.
- Decoded tokenizer → `return _loaded = JanitorLoreBudget(tokenizer.count)`.
- Unreadable cache → `debugPrint('[janitor-lore-budget] cl100k cache unreadable')`; any throw → `debugPrint('[janitor-lore-budget] cl100k unavailable: <e>')`.
- Fallback: `JanitorLoreBudget((t) => (t.length / 3).ceil(), exact: false)` — **3** chars/token here, not the 4 used by `core/llm/tokenizer.dart:_approxTokens`. That is deliberate: a higher token estimate errs towards splitting. The fallback is deliberately **not** memoised, so the next extraction retries the download.

Why `cl100k`: "JanitorAI's web client counts tokens with `gpt-tokenizer` on `cl100k_base` (its `gp-tokenizer-*.js` chunk); Glaze's own BPE on the `cl100k` vocabulary matches it token for token." The instance is private so extraction never switches the tokenizer the active connection counts with.

**`int count(String text)`** → `0` for empty, else `_count(text)`.

**`int loreTokens(Map<String, dynamic> payload, {Map<String, dynamic>? probe})`**

```
final split = stripWrappers(getSystemContent(payload));
var lore = count(split.out);
if (probe != null) {
  final grown = _wrapperTokens(split.removed) - _wrapperTokens(stripWrappers(getSystemContent(probe)).removed);
  if (grown > 0) lore += grown;
}
return lore;
```

So the measure is: the system message **with the wrapper blocks removed** (that is the lore block, exactly what `separate` isolates) plus, when a probe exists, the **token growth of the wrapper blocks** between the two sends. The second term exists because entries placed into a field (personality, scenario, example dialogue) land *inside* a wrapper and are therefore invisible to the first term — with the probe snapshot their share is how much the wrappers grew.

`stripWrappers` / `getSystemContent` come from `janitor_separate.dart`: it removes the leading bracketed jailbreak prefix and the `<...Persona>` / `<Scenario>` / `<Example…>` blocks, returning `({String out, List<RemovedBlock> removed})` with labels `'jailbreak'`, `'card'`, `'userPersona'`, `'scenario'`, `'example'`. `_wrapperTokens` sums `count(b.text)` over those removed blocks.

Consequences to be explicit about: the jailbreak prefix and the JanitorAI credit line are inside the measured wrappers, so credit/prefix drift contributes to `grown`; and wrapper growth is attributed to lore even if the *card* grew (it cannot between two sends in the same chat, which is why the subtraction is sound).

**`bool isSaturated(payload, {probe})`** → `loreTokens(payload, probe: probe) >= janitorLoreTokenCap - janitorLoreSaturationMargin`, i.e. `>= 112000`.

**Trigger halving**

```dart
final _triggerBoundaries = <(RegExp, String)>[
  (RegExp(r'\n\s*\n'), '\n\n'),
  (RegExp(r'\n'), '\n'),
  (RegExp(r'(?<=[.!?…])\s+'), ' '),
  (RegExp(r'\s+'), ' '),
];
```

`List<String> splitTrigger(String text)` tries those boundaries coarsest-first. For each `(boundary, joiner)`: `trimmed.split(boundary)`, trim each unit, drop empties; if fewer than 2 units, try the next boundary. Otherwise compute `total` = sum of unit lengths, start `cut = 1`, `left = units.first.length`, and advance the cut while `cut < units.length - 1 && (left + units[cut].length) * 2 <= total + units[cut].length` (adding each unit's length to `left`). Then return `[units.sublist(0, cut).join(joiner), units.sublist(cut).join(joiner)]`. When no boundary yields two units — a single word — it returns `[trimmed]`, i.e. a one-element list, so the caller must treat "length == 1" as "cannot split further".

The loop condition compares "left half including the candidate unit" against "the rest including the candidate unit", so the cut lands where the left half stops being the smaller one — a near-equal split measured in **characters**, not tokens. (inferred: character length is a proxy for cost here; the code never calls `count`.)

The documented intent: keywords stay whole, and "an entry keyed on two names in one paragraph keeps firing as long as the paragraph does" — hence paragraphs are preferred over lines, over sentences, over words. The sentence boundary is a lookbehind on `[.!?…]` followed by whitespace, so abbreviations split fine and CJK text (no spaces) can only be split by the `\s+` rule.

## Data shapes

Inputs are captured `generateAlpha` payload maps (`messages: [{role, content}, …]`) — the same shape `janitor_separate.dart` consumes. No new models; `RemovedBlock` is reused for the wrapper accounting. Output of `splitTrigger` is `List<String>` of length 2 (or 1 when indivisible).

## Network / WebView contract

No network, no WebView, no injection. The only I/O is reading (and indirectly downloading, via `TokenizerStore.ensureCached`) the `cl100k` tokenizer cache from the app data dir. Consumers pass the budget into `JanitorWebViewProxy.captureGenerateAlpha(loreBudget: …)`, which is where the cap-driven re-fires happen (that file owns `static const int _maxSplitPasses = 16`, the maximum number of follow-up passes).

## Selectors, regexes and string literals

- `RegExp(r'\n\s*\n')` → joiner `'\n\n'`; `RegExp(r'\n')` → `'\n'`; `RegExp(r'(?<=[.!?…])\s+')` → `' '`; `RegExp(r'\s+')` → `' '`.
- Magic numbers: `120000`, `8000`, `3` (fallback chars per token in `(t.length / 3).ceil()`), and the implicit `112000` threshold.
- Paths/ids: `'<dataDir>/tokenizers/cl100k.glztok'` (from `tokenizerCachePath` + `TokenizerKind.cl100k.id == 'cl100k'`), `TokenizerKind.cl100k`.
- Debug strings: `'[janitor-lore-budget] cl100k cache unreadable'`, `'[janitor-lore-budget] cl100k unavailable: <e>'`.
- Referenced external literals: `cl100k_base`, `gpt-tokenizer`, `gp-tokenizer-*.js` (doc comments explaining why `cl100k`).
- No user-visible strings in this file.

## State machine, retries, timings

- One static memo `JanitorLoreBudget? _loaded`; a successful load is permanent for the process (no TTL, no invalidation on vocabulary update). A failed load is retried on the next `load()` call, which means a download attempt per extraction when the store is unavailable.
- `TokenizerStore.ensureCached` may perform a network download on first use; retry/timing behaviour is the store's, not this file's — UNKNOWN — not determined from this file (`core/llm/tokenizers/tokenizer_store.dart` would settle timeouts/retries).
- No timers, no backoff, no attempt counters. The only "retry" concept is the caller's cap-driven pass loop, bounded by the proxy's `_maxSplitPasses = 16`.

## Errors and user-visible messages

None surfaced. Every failure degrades to the `exact: false` character estimate (3 chars/token, i.e. an over-estimate ⇒ more splitting). No exception escapes `load()`.

## Persistence

Read-only: the `cl100k` vocabulary cache at `'<appDataDir>/tokenizers/cl100k.glztok'`, written by `TokenizerStore`. No settings, no state files.

## Porting notes for our SillyTavern port

- **Reproduce literally:** `120000` / `8000` (and therefore the `112000` saturation line); the "separated text + wrapper growth vs. probe" measurement; the 3-chars-per-token over-estimate; the four boundary tiers with their exact joiners; the "return a 1-element list when indivisible" convention.
- **The tokenizer cannot be ported as-is.** `cl100k` here is a downloaded BPE vocabulary in a Dart cache format. Options: (a) bundle/load `gpt-tokenizer` (JS, `cl100k_base`) in the extension — exact match with JanitorAI, which is the point of the whole class; (b) use ST's own `getTokenCount` and accept a few percent error, compensating with the existing 8000 margin. Do **not** use the naive 4-chars estimate: the deliberate 3 is already the pessimistic fallback, and a 4-chars estimate under-counts and will under-split.
- **Dart-only scaffolding:** `dart:io` + `getAppDataDir()` + `File.readAsBytes()` + `decodeTokenizerCache`; the static singleton. In JS these become a lazily-initialised module variable and a fetch/`import` of the tokenizer.
- **Fragile / worth revisiting:**
  - `loreTokens` double-counts if a field-placed entry is *also* visible outside the wrappers (it is not, by construction, but a change in JanitorAI's wrapper naming would silently break the measurement — the regexes match any `*Persona`, `Scenario`, `Example*` tag).
  - `grown > 0` only: if the wrappers *shrink* between probe and capture (e.g. the probe's greeting differs), the negative delta is discarded rather than applied, which biases upward — acceptable given the margin, but it is an asymmetry to know about.
  - The singleton never reloads, so switching the app's tokenizer setting mid-session does not affect this measure (intended) but a corrupted-then-repaired cache also stays unusable until restart.
  - `splitTrigger` measures characters, not tokens, so a paragraph of long CJK text and a paragraph of short English words split at different token points than a token-balanced split would.

## Open questions

- How the caller sequences `isSaturated` with `splitTrigger` (recursive halving tree vs. one level, and whether each half is itself re-checked) — UNKNOWN — not determined from this file; `janitor_webview_proxy.dart:_captureLocked` and the `extraPasses` field of `JanitorCaptureResult` would settle it (I confirmed only that `_maxSplitPasses = 16` exists there and that each pass runs in a fresh chat).
- Whether 120000 is JanitorAI's documented cap or an empirically derived one — the comment says "the cap is applied server-side", no source given. UNKNOWN — a live experiment would settle it.
- Whether `probe` is always supplied by the caller (if not, field-placed entries are under-counted and saturation is detected late) — UNKNOWN — not determined from this file; the proxy's capture code would settle it.
