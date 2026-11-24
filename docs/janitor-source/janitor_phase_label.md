# janitor_phase_label.dart

- **Path:** C:/Users/Gedeon/Documents/Coding/Glaze-stable/lib/features/catalog/widgets/janitor_phase_label.dart
- **Lines:** 51 (read in full: 1-51)
- **Role:** Maps the extractor's/proxy's raw English phase identifiers into localized, user-facing step labels, passing through anything it does not recognize.

## Purpose

The capture pipeline reports progress as bare identifiers meant for the log (`'configuring proxy'`, `'triggering (card)'`, …). This function is the single translation layer between those identifiers and what the user reads. Its header states the contract: "The extractor and the WebView proxy report bare English identifiers (`configuring proxy`, `triggering (card)`, …) meant for the log. Shown as-is they read as jargon, so the UI maps them onto a few plain steps. The split passes carry their `pass N/M` counter along. Anything not known here is left raw rather than dropped, so a new phase still shows up."

It is a pure function — no state, no widgets, no I/O apart from `easy_localization`'s `.tr()`. Two consumers: `widgets/janitor_lorebook_capture_sheet.dart` (lines 1290 and 1814 — the capture's progress line and step list) and `features/character_list/character_detail_screen.dart:1026` (the import FAB's subtitle: `final step = importing ? janitorPhaseLabel(phase) : '';`). `widgets/janitor_extract_sheet.dart` notably **does not** use it.

## Behaviour walkthrough

```
String janitorPhaseLabel(String? phase) {
  final raw = phase?.trim() ?? '';
  if (raw.isEmpty) return '';
  final pass = _passPattern.firstMatch(raw);
  if (pass != null) return 'janitor_phase_trigger_pass'.tr(args: [pass[1]!, pass[2]!]);
  final queue = _queuePattern.firstMatch(raw);
  if (queue != null) {
    final wait = queue[1]?.trim() ?? '';
    return wait.isEmpty ? 'janitor_phase_queue'.tr() : 'janitor_phase_queue_wait'.tr(args: [wait]);
  }
  final key = _keys[raw];
  return key == null ? raw : key.tr();
}
```

Order of resolution matters:

1. **Normalize**: `phase?.trim() ?? ''` — a null phase and a whitespace-only phase both return `''` (not a placeholder). Callers rely on this to decide whether to draw the line at all (`subtitle: step.isEmpty ? null : step`).
2. **Split-pass pattern first**, because a pass label is the only phase carrying two numbers and must not fall through to the generic table.
3. **Queue pattern second**, because it optionally carries a parenthesized wait estimate that must be extracted as an argument, and the base string alone has a different key.
4. **Exact-match table** on the trimmed string — `_keys[raw]`. Note there is **no case folding**: `'Configuring Proxy'` would fall through raw.
5. **Fallback**: return `raw` unchanged. Deliberate ("left raw rather than dropped"), and covered by a test.

`_passPattern = RegExp(r'^triggering \(lorebook, pass (\d+)/(\d+)\)$')` — anchored, so it only matches the proxy's own construction `'triggering (lorebook, $label)'` where `label = 'pass ${pass + 1}/${pass + 1 + queue.length}'`. Renders as `janitor_phase_trigger_pass` with `args: [pass[1]!, pass[2]!]` → `"Triggering entries, part {} of {}"`. The numbers are passed as **strings**, so the template's `{}` placeholders are simple substitutions (no pluralization).

`_queuePattern = RegExp(r'^waiting in queue(?: \(([^)]*)\))?$')` — the optional group is `[^)]*`, so a wait string containing `)` would break the match and fall through to raw. The proxy emits `'waiting in queue'` or `'waiting in queue (${room.estimatedWait})'` (only when `estimatedWait != null`), where `estimatedWait` is the page's `Estimated wait:` value cleaned by `_cleanWait` (e.g. a duration phrase). Renders as `"Waiting in the JanitorAI queue"` or `"Waiting in the JanitorAI queue ({})"` → `"Waiting in the JanitorAI queue (5 minutes)"` (inferred formatting of the estimate; the parser lives in `services/janitor_waiting_room.dart`).

The mapping table, verbatim (19 entries, raw string → i18n key), with the English value from `assets/translations/en.json`:

| raw phase | key | English |
|---|---|---|
| `fetching metadata` | `janitor_phase_metadata` | `"Reading the card"` |
| `loading tokenizer` | `janitor_phase_preparing` | `"Preparing"` |
| `starting` | `janitor_phase_preparing` | `"Preparing"` |
| `configuring proxy` | `janitor_phase_account` | `"Setting up the JanitorAI account"` |
| `checking profile` | `janitor_phase_account` | `"Setting up the JanitorAI account"` |
| `preparing persona` | `janitor_phase_account` | `"Setting up the JanitorAI account"` |
| `creating chat` | `janitor_phase_chat` | `"Opening a chat"` |
| `opening chat` | `janitor_phase_chat` | `"Opening a chat"` |
| `reloading for preset` | `janitor_phase_chat` | `"Opening a chat"` |
| `waiting for chat UI` | `janitor_phase_chat` | `"Opening a chat"` |
| `triggering (card)` | `janitor_phase_card` | `"Getting the character card"` |
| `triggering (lorebook)` | `janitor_phase_trigger` | `"Triggering lorebook entries"` |
| `captured` | `janitor_phase_captured` | `"Prompt captured"` |
| `deleting chat` | `janitor_phase_cleanup` | `"Restoring the account"` |
| `restoring settings` | `janitor_phase_cleanup` | `"Restoring the account"` |
| `separating` | `janitor_phase_separating` | `"Separating the prompt"` |
| `importing character` | `janitor_phase_saving_character` | `"Saving the character"` |
| `rebuilding lorebook (LLM)` | `janitor_phase_building` | `"Building the lorebook"` |
| `saving lorebook` | `janitor_phase_saving_lorebook` | `"Saving the lorebook"` |

Plus the two patterned keys `janitor_phase_trigger_pass` = `"Triggering entries, part {} of {}"`, `janitor_phase_queue` = `"Waiting in the JanitorAI queue"`, `janitor_phase_queue_wait` = `"Waiting in the JanitorAI queue ({})"`.

The design intent visible in the collapsed table: **eleven raw phases collapse into four user steps** (account setup, opening a chat, triggering, restoring the account). The user never sees implementation details like "reloading for preset" or "waiting for chat UI".

## Data shapes

- Input: `String?` — a raw phase from `JanitorExtractor` / `JanitorWebViewProxy` `onPhase` callbacks.
- Output: a non-null `String`, either `''`, a translated label, or the raw input.
- `const _keys = <String, String>{...}` — a compile-time map, no ordering semantics.

Raw phases observed in the producers (`services/janitor_extractor.dart` and `services/janitor_webview_proxy.dart`), as `onPhase`/`phase(...)` arguments: `'fetching metadata'`, `'loading tokenizer'`, `'separating'`, `'importing character'`, `'rebuilding lorebook (LLM)'`, `'saving lorebook'`, `'starting'`, `'configuring proxy'`, `'checking profile'`, `'preparing persona'`, `'triggering (card)'`, `'triggering (lorebook)'`, `'triggering (lorebook, pass N/M)'`, `'captured'`, `'restoring settings'`, `'creating chat'`, `'opening chat'`, `'reloading for preset'`, `'waiting for chat UI'`, `'deleting chat'`, `'waiting in queue'`, `'waiting in queue (...) '`.

Every one of those is covered by this file — **the table is currently complete** (verified against a grep of all `onPhase?.call(`/`phase('…')` literals in the catalog service layer). That completeness is why the raw fallback has never been hit in practice; it exists for new phases added later.

## Network / WebView contract

None. The identifiers it maps are produced by the WebView capture (`/generateAlpha` sends, persona/proxy/chat setup, Cloudflare admission queue) and by the LLM rebuild, but this file only names them.

## Selectors, regexes and string literals

- `final _passPattern = RegExp(r'^triggering \(lorebook, pass (\d+)/(\d+)\)$');`
- `final _queuePattern = RegExp(r'^waiting in queue(?: \(([^)]*)\))?$');`
- The 19 map keys and 21 i18n keys listed above.
- No URLs, no CSS selectors, no user-facing literal strings of its own (every visible string comes from `en.json`).

## State machine, retries, timings

Stateless and synchronous. There is no notion of a phase *sequence*: the function maps each value independently, so a caller showing a progress line just replaces the text. Ordering, deduplication and "is this going backwards" are the caller's problem — the capture sheet keeps `_extractPhase` (a string, null between steps) and renders it; the import FAB shows it as a subtitle while `importing` is true.

No retries, no timers. The only timing-shaped behaviour is that the queue label can change while the user waits (the proxy re-announces only when the parsed room *changes*: `if (room == lastRoom) return;`), so the label updates at most once per distinct estimate/refresh-interval pair.

## Errors and user-visible messages

No error handling: a mapping miss is not an error, it is the raw pass-through. Consequences worth knowing:

- A phase string with unexpected punctuation, capitalization, or an embedded `)` renders verbatim in the UI (e.g. `waiting in queue (5 (est.))` would show raw).
- Because the fallback returns the *trimmed* input, leading/trailing whitespace never leaks into the UI.
- The one visible empty case (`''`) means callers must handle it; `character_detail_screen.dart` does (`subtitle: step.isEmpty ? null : step`).

## Persistence

None.

## Porting notes for our SillyTavern port

1. **Port this table verbatim** — it is the entire user-facing vocabulary of the extraction pipeline, and it is cheap: eleven implementation phases → four steps (account, chat, triggering, cleanup) plus one-off labels. Our extension will emit the same phases (metadata fetch, proxy/persona setup, chat creation, trigger sends, separation, import, LLM build), so the identifiers can stay identical and only the destination strings change.
2. **Keep the raw fallback.** A pass-through is what lets us add a phase (e.g. `'waiting for admission'`, `'retrying generateAlpha'`) without touching the UI, and it degrades to jargon rather than to a blank line. Do not throw or return "Unknown".
3. **Keep the two patterned cases first, and anchor them.** `^…$` anchoring is why `'triggering (lorebook)'` (the single-pass case) correctly falls to `janitor_phase_trigger` instead of trying to match the pass variant. In JS: `/^triggering \(lorebook, pass (\d+)\/(\d+)\)$/` and `/^waiting in queue(?: \(([^)]*)\))?$/`.
4. **Split passes are the one place where a plain step label is not enough**: `"Triggering entries, part 2 of 5"` tells the user the job is progressing through a bounded number of sends. Our port's chunked lorebook rebuild needs the same treatment (Glaze's build has its own `onProgress(done, total)` path for that, separate from `onPhase`).
5. **Do not trim the meaning out of the queue label.** `"Waiting in the JanitorAI queue (5 minutes)"` is one of the few messages that explains a multi-minute silence. If our port has to wait on JanitorAI's admission queue (it will, if it drives the same endpoints), surface the estimate the page reports rather than a spinner.
6. **The one consumer that skipped this function is the dev sheet** (`janitor_extract_sheet.dart` prints `_phase` raw). If we build an equivalent debug panel, keep it raw deliberately — but never as the user-facing path.
7. Localization note: the `{}` placeholders are easy_localization's positional syntax, not `printf`. In our extension these become template strings; keep the empty-estimate variant as a separate key rather than an empty `()`.

## Open questions

- Whether `.tr()` with two positional args on `janitor_phase_trigger_pass` pluralizes in the Russian locale (the repo ships `ru.json`) — the args are strings, so any plural handling would be inside the translation string itself. `assets/translations/ru.json` would settle it.
- Whether any phase is emitted *outside* the catalog service layer (e.g. by the catalog controller during `importCharacter`) that this table does not know — a repo-wide grep for `onPhase` in `lib/` beyond the catalog services would settle it; the launcher and capture sheet both pass the callback through unchanged.
- Whether `_cleanWait` ever returns a string containing `)` or `(` (which would defeat `_queuePattern`) — `services/janitor_waiting_room.dart` `_cleanWait` would settle it.
- Whether the capture sheet wraps this output in additional formatting (icons per step, a step list at line 1814) that changes what the user actually sees — `widgets/janitor_lorebook_capture_sheet.dart` around lines 1280-1300 and 1800-1830.
