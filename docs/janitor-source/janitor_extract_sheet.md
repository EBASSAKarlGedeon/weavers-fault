# janitor_extract_sheet.dart

- **Path:** C:/Users/Gedeon/Documents/Coding/Glaze-stable/lib/features/catalog/widgets/janitor_extract_sheet.dart
- **Lines:** 293 (read in full: 1-293)
- **Role:** Modal "dev tool" sheet that takes one JanitorAI character URL, runs the full capture→separate→preview pipeline, and on Save commits the character plus an LLM-rebuilt closed lorebook to the local DB.

## Purpose

This is the *single-shot* front end for `JanitorExtractor`: paste a URL, `Run`, look at a five-line preview, `Save to DB`. It bypasses every choice the real import flow makes (trigger-context selection, public-lorebook attachment, import mode, `janitorMeta`) by relying entirely on the extractor's defaults. Its own header string states the contract: `'Captures the hidden card and triggered lorebook via the webview proxy, then rebuilds entries with the active LLM. Requires being logged into JanitorAI and an active API connection.'`

It is reached from a developer/test section of the menu (`lib/features/menu/menu_screen.dart:409`, `MenuItem(icon: Icons.auto_stories_outlined, label: 'Janitor: extract card + lorebook')`, sitting among `menu_menu_group_demo`, `menu_spinner_demo`, `menu_notifications_test`). It is **not** the Loreweaver-relevant entry point — the capture sheet (`janitor_lorebook_capture_sheet.dart`) is — but it is the smallest complete statement of what the pipeline needs, and therefore the best template for a JS port of the "capture + rebuild" contract.

## Behaviour walkthrough

`showJanitorExtractSheet(BuildContext context)` calls `showGlazeSheet<void>` with `useRootNavigator: true`, `useSafeArea: true`, `isScrollControlled: true`, `backgroundColor: Colors.transparent`, `barrierColor: Colors.black54`, builder `const _JanitorExtractSheet()`. It returns nothing; there is no result channel to the caller.

`_JanitorExtractSheet` is a `ConsumerStatefulWidget`; state is five fields: `_controller` (the URL `TextEditingController`), `bool _busy`, `String? _phase`, `LabeledError? _error`, `ExtractionResult? _result`. `dispose()` only disposes the controller — **closing the sheet never cancels a running extract or commit**; the futures keep running and every callback is `mounted`-guarded.

`_run()`:
1. `final url = _controller.text.trim(); if (url.isEmpty) return;` — no validation beyond non-empty; the URL is not parsed here (the extractor's `_parseCharacterId` does that and throws `Exception('No character id found in: $input')` when no UUID is present).
2. `setState(() { _busy = true; _error = null; _phase = null; _result = null; })` — a re-run wipes the previous preview immediately.
3. `await ref.read(janitorExtractorProvider).extract(url, onPhase: (p) { if (mounted) setState(() => _phase = p); })`. **No `trigger:` argument and no `extraPublicContents`**: the capture therefore runs with the default `JanitorTriggerContext()` — `card: true, catalog: true, scenario: true, greetings: false, lorebookDescs: false, extra: ''` — and subtracts only the *public lorebook* contents from the captured text.
4. `catch (e)` → `_error = describeCatalogError(e, fallback: CatalogErrorSource.janitor)`.
5. `finally` → `_busy = false`.

`_save()`:
1. Returns silently if `_result == null`.
2. `_busy = true; _error = null` (the previous `_result` is **not** cleared, so the preview stays on screen while saving).
3. `await ref.read(janitorExtractorProvider).commit(result, onPhase: (p) {...})` — again defaults: `rebuildLorebook: true`, `attachPublicLorebooks: false`, `janitorMeta: null`.
4. On success: `Navigator.of(context).pop();` **then** `GlazeToast.show(context, msg)` where `msg` is either
   `'Imported ${commit.characterName} (lorebook failed: ${commit.lorebookError})'` when `commit.lorebookError != null`, or
   `'Imported ${commit.characterName} + ${commit.lorebookEntryCount} lorebook entries'`.
   The toast is shown through the popped sheet's `context`; the sheet route is gone but `GlazeToast` renders at app level, so this works (inferred: the code reads `context` after `pop()`, which is only safe because nothing else touches the deactivated State).
5. `catch (e)` → same `describeCatalogError(..., fallback: CatalogErrorSource.janitor)`.
6. `finally` → `_busy = false`.

A re-run is always available; after a result exists the primary button label flips from `'Run'` to `'Re-run'` and a second button `'Save to DB'` appears.

## Data shapes

`ExtractionResult` (`services/janitor_extractor.dart`) as consumed by `_Preview`:

- `result.character` is a `DownloadedCharacter`; the preview reads `result.character.charData` (`CharacterData`) and uses `card.name`, `card.description`, `card.scenario`, `card.firstMes`.
- `result.hasLorebook` is `lorebookText.trim().isNotEmpty`.
- `result.lorebookText` is the merged closed-lorebook text (separator output + field-diff recovery).
- `result.entryBlockCount` (`splitEntries(lorebookText).length`) exists but the preview **does not display it**.
- Not displayed anywhere in this sheet, though computed: `characterId`, `sourceUrl`, `cardContext`, `catalogContext`, `scenarioContext`, `greetingsContext`, `lorebookDescsContext`, `injected`.

`CommitResult` fields used: `characterName`, `lorebookEntryCount`, `lorebookError` (the `glazeCharacterId` is ignored — the sheet does not navigate to the imported character).

`LabeledError { CatalogErrorSource source; String message; String get label; String get inline; }` — the sheet renders `GlazeErrorBlock(message: _error!.message, label: _error!.label)`, so the block carries a shouting header (`error_source_janitor` = `"JANITOR ERROR"`, `error_source_provider` = `"PROVIDER ERROR"`, `error_source_generic` = `"ERROR"`).

## Network / WebView contract

None directly — the sheet does not touch the WebView. All network happens inside `JanitorExtractor.extract` / `.commit`, which it drives through `janitorExtractorProvider`. The relevant consequences of *this sheet's call style*:

- `extract(url, onPhase:)` → `JanitorWebViewProxy.instance.captureGenerateAlpha(...)`; the proxy is marked active for the duration (`proxy.setActive(true)` / `finally proxy.setActive(false)`), and a `GenerationNotificationService.acquireWorkHold(title: 'Glaze', text: 'notification_extracting'.tr())` keeps an Android foreground service alive (`"Extracting character..."`).
- Metadata comes from `https://janitorai.com/hampter/characters/$characterId` (inside the extractor).
- `commit(...)` takes a second work hold with `notification_importing` (`"Importing character..."`), imports through `catalogProvider.notifier.importCharacter(result.character, sourceUrl: result.sourceUrl, attachLorebooks: false, janitorMeta: null)`, then rebuilds with `rebuildLorebookWithActiveLlm`.
- Because `janitorMeta` is `null`, this path persists no Janitor metadata alongside the character (tags and creator come from `meta` *inside* the extractor, but whatever `janitorMeta` carries in the real flow — the public-definition flag, script refs — is absent). (inferred: that `importCharacter` stores `janitorMeta` rather than using it only at import time; `catalog_provider.dart` would settle it.) Porting lesson: keep the raw metadata with the imported character, so a later public-lorebook fetch or rebuild does not need a second metadata round trip.

## Selectors, regexes and string literals

User-visible strings defined here (verbatim):

- Title: `'JanitorAI — Extract card + closed lorebook'` (16px, `FontWeight.w700`).
- Subtitle: `'Captures the hidden card and triggered lorebook via the webview proxy, then rebuilds entries with the active LLM. Requires being logged into JanitorAI and an active API connection.'`
- Field hint: `'https://janitorai.com/characters/...'`
- Busy fallback: `'Working…'` (only when `_phase` is null).
- Buttons: `'Run'`, `'Re-run'`, `'Save to DB'`.
- Preview labels: `'Name: ${card.name}'`, `'Card (description): ${estimateTokens(card.description)} tokens'`, `'Scenario: ${estimateTokens(card.scenario)} tokens'`, `'First message: ${estimateTokens(card.firstMes)} tokens'`, `'Closed lorebook: ${...}'` where the value is either `'extracted content, ${estimateTokens(result.lorebookText)} tokens'` or `'none found'`, and the header `'Extracted content (preview):'`.
- Toast templates as quoted in the walkthrough.

No regexes, no CSS selectors, no URLs of its own beyond the hint text.

Truncation literal: the preview cuts at 600 characters — `result.lorebookText.length > 600 ? '${result.lorebookText.substring(0, 600)}…' : result.lorebookText` (note the U+2026 ellipsis appended after the slice, so 601 rendered characters).

Layout literals: sheet `BorderRadius.vertical(top: Radius.circular(20))`, drag handle `width: 40, height: 4`, content padding `EdgeInsets.fromLTRB(20, 16, 20, 24)`, spinner `18x18`, preview container `EdgeInsets.all(12)` + `BorderRadius.circular(12)`.

## State machine, retries, timings

States: `idle` (no result, not busy) → `running` (`_busy`, `_phase` live) → `preview` (`_result != null && !_busy`) → `saving` (`_busy`, `_result` retained) → `done` (popped) or `error` (`_error != null`, `_result` may still be present so the user can retry Save).

- No retry logic, no backoff, no timeouts in this file. Every timeout lives in the proxy (`hasSessionToken` 8 s, `fetchUserName` 10 s) or in `captureGenerateAlpha`.
- `_busy` disables: the text field (`enabled: !_busy`), both buttons (`onTap: _busy ? null : ...`), and the busy row replaces nothing — errors and preview are hidden while busy (`if (_result != null && !_busy)`).
- Re-entrancy: `onSubmitted: (_) => _busy ? null : _run()` and the Run button (`onTap: _busy ? null : _run`, evaluated at build time) both consult `_busy`, but `_run()` itself has **no** `if (_busy) return;` guard. A second tap that lands before the rebuilding frame would start a concurrent capture (inferred: `setState` marks dirty rather than rebuilding synchronously, and the button's closure is already `_run`).
- Cancellation: none. Closing the sheet leaves the capture and the LLM rebuild running; the phase callback is dropped by `if (mounted)`.

## Errors and user-visible messages

All failures funnel through `describeCatalogError(e, fallback: CatalogErrorSource.janitor)` → `GlazeErrorBlock`. Concretely, from `services/catalog_error_labels.dart`:

- `JanitorAuthException` → message `catalog_janitor_session_expired`.tr() = `"Log into your Janitor.AI account again to import this character. The stored session is no longer accepted, so the capture cannot run."`
- `JanitorRefusedException` → `'${error.message}.\n${'catalog_janitor_refused_body'.tr()}'` — i.e. JanitorAI's own sentence plus `"Because of that, Glaze is unable to recover the character and its lorebooks (if it has them)."`
- `JanitorQueueException` → `"JanitorAI is still in its admission queue and did not let Glaze in. Try again in a few minutes."`
- `JanitorCfException` → `"JanitorAI is behind Cloudflare and did not return the character. Try another provider like Janny, DataCat, or Chub."`
- `NoActiveConnectionException` → `"No active LLM connection. Add one in Settings → API and select it before building a lorebook."`
- `LorebookBuildException` → `error.source` + `error.message`.
- Anything else → `formatError(error)` with the fallback source.

**Important divergence from the real flow:** a refusal is rendered *inline as an error block here*, never through `showJanitorRefusedSheet`; there is no "import public part anyway" affordance on this sheet. The user sees the sentence and stops. Likewise a 401 gets an error block rather than the `showJanitorSessionExpiredSheet` re-login prompt.

The one path that does not report a failure is a lorebook rebuild failure during Save: it is swallowed into `CommitResult.lorebookError` and surfaced only in the success toast (`'Imported X (lorebook failed: ...)'`).

## Persistence

None of its own. Writes are entirely via `JanitorExtractor.commit` → `catalogProvider.notifier.importCharacter` (character row + avatar) and `ref.read(lorebooksProvider.notifier).put(lorebook)` with `name: '${result.character.charData.name} — Closed Lorebook'`. Sheet state (`_phase`, `_result`) is ephemeral and lost on dismiss.

## Porting notes for our SillyTavern port

1. **This is the minimal viable contract**, and it maps almost 1:1 onto what we need in Weaver's Vault: one input (character URL or id), one long-running job with periodic phase callbacks, one preview, one commit. Use it as the skeleton for a `captureThenRebuild()` helper, not as the UI.
2. **Do not copy the default `ExtractionResult` → `commit` call.** `rebuildLorebook: true` + `attachPublicLorebooks: false` + `janitorMeta: null` means the public books are *not* imported and the closed book is rebuilt blind to the context the real flow would supply. In our port the equivalent is: import the card first, then let the user drive a separate lorebook capture with explicit trigger context, and attach public books directly (they need no LLM).
3. **`JanitorTriggerContext` defaults matter.** card+catalog+scenario in, greetings+lorebookDescs out, `extra: ''`. If our port offers a "capture now" button, these three are the safe automatic set; the other two are opt-in because they inflate the trigger text.
4. **Phase strings are raw identifiers.** This sheet prints `_phase` directly, so a user reads `configuring proxy` / `triggering (lorebook, pass 3/5)`. Everywhere else Glaze funnels them through `janitorPhaseLabel()` (`janitor_phase_label.dart`). Our port should localize from day one; the mapping table is already written and should be ported wholesale.
5. **Pop-then-toast** is the pattern for "job finished, get out of the way": the sheet closes first so the toast is not clipped by the sheet, and the message contains the outcome (including the partial-failure case). Worth copying — a rebuild failure must not read as a total failure.
6. **No cancel button is a deliberate simplification**: the job is expensive and the sheet is disposable. In a JS extension we get cancellation for free via `AbortController`, but the *product* decision to let the job finish is defensible; if we copy it, we must not `setState` after the UI is gone (guard on "sheet still open").
7. The URL hint `https://janitorai.com/characters/...` implies we accept a *page URL*, and the extractor pulls the UUID out with `[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}` (case-insensitive). Our extension should accept either the full URL or the bare UUID from the same regex.
8. `estimateTokens` is only used for the preview's cost readout; it is the active tokenizer when one is loaded, an approximation otherwise. Not a functional dependency.

## Open questions

- Whether `Navigator.of(context).pop()` followed by `GlazeToast.show(context, ...)` is safe on every platform/route — the `context` is from a `State` that is being torn down. Not determined from this file; `shared/widgets/glaze_toast.dart` would settle it.
- Whether the sheet is gated by developer/debug flags — the menu placement suggests a dev section, but the enclosing `MenuGroup` header is not visible in the read window; `lib/features/menu/menu_screen.dart` around line 300-340 would settle it.
- Whether `extract` ever surfaces a refusal *before* the user hits Save (it can: `janitorAllowsProxy(meta)` throws `JanitorRefusedException.proxyForbidden()` right after metadata). The sheet then shows it as an error block — confirmed by the code path, but no fixture covers it; `test/` has no extract-sheet test (inferred from the file list in `test/`).
