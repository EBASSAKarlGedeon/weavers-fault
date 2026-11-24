# janitor_extractor.dart

- **Path:** C:/Users/Gedeon/Documents/Coding/Glaze-stable/lib/features/catalog/services/janitor_extractor.dart
- **Lines:** 655 (read in full: 1-400, 401-655)
- **Role:** Two-phase orchestrator — phase 1 drives the headless-WebView capture and turns the assembled `/generateAlpha` prompt plus `/hampter/characters/{id}` metadata into card fields + isolated closed-lorebook text; phase 2 writes the character (and optionally an LLM-rebuilt lorebook) to the DB.

## Purpose

The file is the Dart port of the SillyTavern `janitor-lorebook` extension pipeline, rebuilt on Glaze's own `JanitorWebViewProxy` and the active LLM. It owns three things and nothing else: (a) *which* public context is stuffed into the trigger message that makes JanitorAI's server fire closed-lorebook entries (`JanitorTriggerContext`), (b) the *order* in which captured prompt material is split into SillyTavern-shaped fields (`name`, `description`, `scenario`, `firstMes`, `mesExample`, `creatorNotes`, `tags`, `creator`, `creatorId`, `alternateGreetings`), and (c) the commit into `catalogProvider.importCharacter` + `lorebooksProvider.put`.

It contains no DOM work of its own: every browser-side read is one of two proxy calls — `JanitorWebViewProxy.instance.fetch(...)` for metadata, `JanitorWebViewProxy.instance.captureGenerateAlpha(...)` for the assembled prompt. The split/clean logic lives in `janitor_separate.dart` (wrappers, public-entry subtraction, macro restoration) and `janitor_field_diff.dart` (recovering lore injected *into* fields).

## Behaviour walkthrough

### Value types

`ExtractionResult` carries: `characterId` (JanitorAI character UUID, doc comment "JanitorAI character UUID"), `sourceUrl`, `character` (`DownloadedCharacter`, "with the hidden card now in `description`"), `lorebookText`, `entryBlockCount`, `cardContext`, `catalogContext`, `injected` (`List<InjectedBlock>`), `scenarioContext`, `greetingsContext`, `lorebookDescsContext` (last three default `''`, `injected` defaults `const []`). Getter `hasLorebook => lorebookText.trim().isNotEmpty`.

`JanitorTriggerContext` defaults: `card = true`, `catalog = true`, `scenario = true`, `greetings = false`, `lorebookDescs = false`, `extra = ''`. The comment states this is a "Port of JAR's `exSources`, with the same defaults".

`CommitResult`: `glazeCharacterId`, `characterName`, `lorebookEntryCount`, `String? lorebookError`.

`static final _uuid = RegExp(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', caseSensitive: false)`.

### `extract(url, {trigger, onPhase, extraPublicContents})`

1. `_parseCharacterId(url)`: `_uuid.firstMatch(input.trim())`; no match ⇒ `throw Exception('No character id found in: $input')`. Note: it scans the **whole URL string**, not a path segment, so any UUID anywhere in the input is accepted.
2. `GenerationNotificationService.instance.acquireWorkHold(title: 'Glaze', text: 'notification_extracting'.tr())` — an Android foreground-service hold so the process is not frozen mid-extraction; no-op on desktop.
3. `proxy.setActive(true)` keeps the offscreen WebView alive for the whole run. `finally` reverses both (`proxy.setActive(false)`, `await hold.release()`).
4. `onPhase?.call('fetching metadata')` → `_fetchMeta(characterId)`: `proxy.fetch('https://janitorai.com/hampter/characters/$characterId')`, `jsonDecode`, returns the map or `null`. **A metadata failure is swallowed** (`debugPrint('[janitor-extractor] meta fetch failed: $e')`) and the run continues with `meta == null`.
5. Proxy gate: `if (!janitorAllowsProxy(meta)) throw const JanitorRefusedException.proxyForbidden();` — `janitorAllowsProxy` (in `janitor_provider.dart`) is `meta == null || meta['allow_proxy'] != false`, so a `null` meta passes. The exception is `status = 403`, `message = 'Proxies are forbidden for this character'`. Comment: `allow_proxy: false` means `/generateAlpha` answers 403 and nothing could be captured — "Stop on the metadata instead of driving the whole capture to reach the same refusal a minute later."
6. `contextFromMeta(meta)` returns a record `({String catalog, String scenario, String greetings})`:
   - `greetings` = `normalizeGreetings(primary: meta['first_message'] is String ? ... : null, others: greetingList(meta['first_messages']))`, then `[firstMes, ...alternates].map(_htmlToText).where(non-empty).join('\n\n---\n\n')`.
   - `catalog` = `_buildCatalogContext(meta)` (below).
   - `scenario` = `_htmlToText((meta['scenario'] ?? '').toString())`.
7. `fetchPublicLorebooks(meta)` (from `janitor_public_lorebook.dart`) — fetched **once** and used three ways: `publicEntryContents(publicBooks)` verbatim entry bodies to subtract, plus caller-supplied `extraPublicContents` (a public *script* the user already converted), and `buildLorebookDescsContext(publicBooks)` for key-inference context.
8. Trigger text assembly, in this exact order and joined with `'\n\n'` after `.trim()` per part and dropping empties:
   - `if (trigger.catalog) metaCtx.catalog`
   - `if (trigger.scenario) metaCtx.scenario`
   - `if (trigger.greetings && metaGreetings) metaCtx.greetings` where `metaGreetings = metaCtx.greetings.trim().isNotEmpty`
   - `if (trigger.lorebookDescs) lorebookDescs`
   - `trigger.extra`
   Rationale in comments: everything goes into "a single latest user turn so every keyword stays within JanitorAI's server-side scan depth"; the card is added by the capture itself.
9. `onPhase?.call('loading tokenizer')` → `await JanitorLoreBudget.load()` (a `cl100k` tokenizer; the budget lets the capture detect JanitorAI's per-prompt lore cap).
10. `proxy.captureGenerateAlpha(characterId:, triggerText:, includeCard: trigger.card, includeChatGreetings: trigger.greetings && !metaGreetings, loreBudget:, onPhase:)`. Returns `JanitorCaptureResult` with `payload`, `probePayload` (the `"."` send), `extraPasses`, `greetings` (from the chat object), `bakedUserName`.
11. `onPhase?.call('separating')`. `rawCard = extractCard(payload)`; `separatedText = mergeLorebookTexts([for (final p in [payload, ...capture.extraPasses]) separate(p, rawCard, publicContents).lorebookText])`.
12. Name resolution: `extractCharName(payload)` if non-empty, else `(meta?['name'] ?? 'Unknown').toString()` — the literal fallback string is `'Unknown'`. (`extractCharName` is called twice; no caching.)
13. `charNames` = `{name, meta['name'], meta['chat_name']}` filtered non-blank. Local closure `macro(text) => restoreMacros(stripJanitorCredit(text), charNames: charNames, userName: capture.bakedUserName)`.
14. `definitionPublic = meta != null && janitorDefinitionPublic(meta)` (`showdefinition == true` **and** non-empty `personality` or `scenario`). `probeFields = capture.probePayload == null ? null : PromptFields.fromPayload(capture.probePayload, restore: macro)`. `cleanFields = definitionPublic ? PromptFields.fromMeta(meta) : null`.
15. `separated = macro(separatedText)`; `scan = scanInjectedFields(capture: PromptFields.fromPayload(payload, restore: macro), extraCaptures: [...], probe: probeFields, clean: cleanFields, publicContents: publicContents, existing: separated)`.
16. `lorebookText = [separated, scan.text].map(trim).where(non-empty).join('\n\n')`.
17. Card fields come from the **probe**, not the trigger send: `cardSource = probePayload ?? payload`; `capturedScenario = extractScenario(cardSource)`; `card = withoutInjected(macro(extractCard(cardSource)), InjectionField.persona, scan)`; `scenario = withoutInjected(macro(capturedScenario.isNotEmpty ? capturedScenario : (meta?['scenario'] ?? '').toString()), InjectionField.scenario, scan)`; `example = withoutInjected(macro(extractExample(cardSource)), InjectionField.example, scan)`. Comment: the trigger exists to fire entries, and entries writing into fields would otherwise be imported as part of the character.
18. Greetings: `normalizeExtractedGreetings(chat: capture.greetings.map(macro).toList(), catalog: [if (meta?['first_message'] is String) meta!['first_message'] as String, ...greetingList(meta?['first_messages'])].map(macro).toList(), captured: macro(extractFirstMessage(cardSource)))` ⇒ `firstMes` + `alternates`. `allGreetings = [if (firstMes.isNotEmpty) firstMes, ...alternateGreetings]`.
19. `tags = (meta?['custom_tags'] is List) ? (meta!['custom_tags'] as List).map((e) => e.toString()).toList() : <String>[]`; `avatar = resolveJanitorAvatar(meta?['avatar'] as String?)`. **Note the hard cast** `meta?['avatar'] as String?` — a non-String, non-null `avatar` value would throw.
20. `DownloadedCharacter` built with `CharacterData(name: name, description: card, scenario: scenario, firstMes: firstMes, mesExample: example, creatorNotes: _htmlToText((meta?['description'] ?? '').toString()), tags: tags, creator: (meta?['creator_name'] ?? meta?['creator'] ?? '').toString(), creatorId: (meta?['creator_id'] ?? '').toString(), alternateGreetings: alternateGreetings)`. `personality`, `systemPrompt`, `postHistoryInstructions`, `characterBook` are left at their defaults (`''` / null).
21. Context split for the later LLM build: `greetingsContext = allGreetings.join('\n\n---\n\n')`; `cardContext = (cleanFields != null && cleanFields.persona.trim().isNotEmpty) ? cleanFields.persona : card`; `scenarioContext` likewise from `cleanFields.scenario` falling back to `scenario`. Rationale: for the build, the captured copy has injected lore baked in and would teach the model to discard it; the catalog's clean copy is preferred wherever it exists.
22. Returns `ExtractionResult(..., entryBlockCount: splitEntries(lorebookText).length, ...)`.

### `commit(result, {onPhase, rebuildLorebook: true, attachPublicLorebooks: false, janitorMeta})`

Wraps `_commit` in a work hold (`text: 'notification_importing'.tr()`). `_commit`:
1. `onPhase?.call('importing character')` → `catalogProvider.notifier.importCharacter(result.character, sourceUrl: result.sourceUrl, attachLorebooks: attachPublicLorebooks, janitorMeta: janitorMeta)` returns the new Glaze id.
2. `!rebuildLorebook` ⇒ `CommitResult(lorebookEntryCount: 0)`. `!result.hasLorebook` ⇒ same.
3. `onPhase?.call('rebuilding lorebook (LLM)')` → `rebuildLorebookWithActiveLlm(_ref, lorebookText:, name: '${result.character.charData.name} — Closed Lorebook', card: result.cardContext, catalog: result.catalogContext, scenario: result.scenarioContext, greetings: result.greetingsContext, lorebookDescs: result.lorebookDescsContext, characterId: glazeId)` (note the em dash `—` U+2014 in the name). `onPhase?.call('saving lorebook')` → `lorebooksProvider.notifier.put(lorebook)`.
4. Failure ⇒ `debugPrint('[janitor-extractor] lorebook rebuild failed: $e')` and `CommitResult(..., lorebookError: describeCatalogError(e, fallback: CatalogErrorSource.provider).inline)` — a lorebook failure never discards the imported character.

### Pass-throughs

`buildLorebook({lorebookText, name, card, catalog, scenario, greetings, lorebookDescs, extra, characterId, onProgress, partCache})` forwards to `rebuildLorebookWithActiveLlm`. `buildLorebookFromJs({jsSource, name, meta, characterId})` calls it with `fromJs: true`, `catalog: _buildCatalogContext(meta)`, `scenario: _htmlToText(meta['scenario'])`, `lorebookDescs: await _lorebookDescs(meta)`.

### `_buildCatalogContext(meta)`

Parts, joined `'\n\n'`, omitted when empty:
- `'Name: $name'`
- `'Tags: ${tags.join(', ')}'` (only when `custom_tags` is a non-empty List)
- `'Catalog description:\n$desc'`
- `'Scenario:\n$scenario'`
- `'Attached lorebooks (titles only — contents are hidden):\n${books.join('\n')}'` where books come from `meta['scripts']` filtered to `s['type'] == 'lorebook' || s['type'] == 'advanced'`, each rendered `'- ${s['title'] ?? ''}${s['description'] != null ? ': ${s['description']}' : ''}'`.

### `_htmlToText(html)`

Ordered: `<br\s*/?>` (ci) → `\n`; `</(p|div|li|h\d)>` (ci) → `\n`; strip `<[^>]+>`; then entity replacements `&nbsp;`→` `, `&amp;`→`&`, `&lt;`→`<`, `&gt;`→`>`, `&#39;|&apos;`→`'`, `&quot;`→`"`; then collapse `\n{3,}`→`\n\n`, `[ \t]+`→`' '`, `trim()`. Entities are replaced **after** tag stripping, so an entity-encoded tag stays as text.

### `_lorebookDescs(meta)`

`fetchPublicLorebooks(meta)` then `buildLorebookDescsContext(books)` — one extra round-trip per attached public book, only used by `buildLorebookFromJs`.

`final janitorExtractorProvider = Provider<JanitorExtractor>((ref) => JanitorExtractor(ref));`

## Data shapes

`meta` (from `GET /hampter/characters/{id}`) keys actually read here: `name`, `chat_name`, `description`, `scenario`, `first_message`, `first_messages` (List), `custom_tags` (List), `creator_name`, `creator`, `creator_id`, `avatar`, `scripts` (List of maps with `type`, `title`, `description`), `allow_proxy`, `showdefinition`, `personality`. (`PromptFields.fromMeta` additionally reads `example_dialogs` / `mes_example`.)

Captured `generateAlpha` payload: `{'messages': [{'role': 'system'|'assistant', 'content': String}, ...]}` — the separator only looks for the first `role == 'system'` message and the first `role == 'assistant'` message.

Outbound card shape (`CharacterData`): `name`, `description` (the recovered card), `personality` (empty), `scenario`, `firstMes`, `mesExample`, `creatorNotes` (HTML-stripped catalog `description`), `systemPrompt` (empty), `postHistoryInstructions` (empty), `alternateGreetings`, `tags`, `creator`, `creatorId`, `characterBook` (null). `DownloadedCharacter` adds `avatarUrl` (already resolved) and `avatarBytes` (unused here).

## Network / WebView contract

Directly from this file:
- `GET https://janitorai.com/hampter/characters/{characterId}` — via `JanitorWebViewProxy.fetch`, which runs the request **inside** the offscreen WebView page (`callAsyncJavaScript`, `credentials: "include"`, headers `{"Accept": "application/json, text/plain, */*"}` plus `authorization: Bearer <jwt>` when a token is found; `Content-Type: application/json` when a body is present; 25 s JS-call timeout). Response parsed as JSON object; anything else ⇒ `null`.

Indirectly, through `captureGenerateAlpha` (file `services/janitor_webview_proxy.dart`, read for context):
- `POST https://janitorai.com/hampter/chats` body `{"character_id": ..., "persona_id": ...}` → `id` of the new chat; `DELETE https://janitorai.com/hampter/chats/{id}` afterwards.
- Navigate to `https://janitorai.com/chats/{chatId}`, reload once ("reloading for preset"), then drive `window.__glazeSend(text)` (injected at `AT_DOCUMENT_START`).
- The payload is *not* a request this code makes: `_captureUserScript` wraps `window.fetch` **and** `XMLHttpRequest` and stashes the last response whose URL contains `/generateAlpha` and whose JSON has a `messages` array containing a `role: 'system'` string `content` (global `window.__glazeAlpha`); a bounded `window.__glazeAlphaLog` (max 12 entries, each `{via, status, matched, body}`) records every observation for timeout diagnostics.
- The composer drive: `dismissModals`, `findStopButton` abort loop (15 s), `setReactValue` (native `HTMLTextAreaElement.prototype` value setter + `input` event), `findSendButton` click or synthetic Enter (`keyCode`/`which` forced to 13), then `waitComposerCleared` verification.
- Selectors used for the send (worth porting verbatim only if we do a browser-side capture): `textarea[placeholder]`, `form textarea`, `textarea`, `div[contenteditable="true"]`; send candidates `button[aria-label*="send" i], button[class*="sendButton" i], button[type="submit"]`; stop candidates `button[aria-label*="stop" i], button[aria-label*="cancel" i]`; overlay `[class*="modalOverlay" i], [class*="ModalOverlay"]`; close `[class*="modal" i] button[aria-label*="close" i], [role="dialog"] button[aria-label*="close" i]`; tagged composer `[data-glaze-composer]`.
- Account plumbing the capture requires: `GET`/`POST https://janitorai.com/hampter/personas` (create persona `{"appearance": "", "avatar": "", "groupId": null, "name": "{{user}}", "pronouns": null}`), `DELETE /hampter/personas/{id}`, `GET https://janitorai.com/hampter/profiles/mine`, `GET`/`PATCH https://janitorai.com/hampter/api-settings`, `POST`/`DELETE https://janitorai.com/hampter/api-settings/proxy-configs`. The dummy proxy preset body is `{"api_key": "sk-<48 random>", "api_url": "http://127.0.0.1:<8001..65000>/v1/chat/completions", "model": "gpt-4o", "name": "<12 random>", "prompt_id": null, "client_id": "<uuid v4>"}`.

Our port does not need any of this if we capture in the page — but it does need the *shape* assumption: the assembled prompt arrives as `{"messages":[{"role":"system","content":"..."}]}`.

## Selectors, regexes and string literals

- `_uuid`: `r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'`, `caseSensitive: false`.
- HTML→text: `r'<br\s*/?>'`, `r'</(p|div|li|h\d)>'`, `r'<[^>]+>'`, `r'&#39;|&apos;'`, `r'\n{3,}'`, `r'[ \t]+'`.
- Context labels (exact): `'Name: '`, `'Tags: '`, `'Catalog description:\n'`, `'Scenario:\n'`, `'Attached lorebooks (titles only — contents are hidden):\n'`, `'- '`, `': '`.
- Joiners: `'\n\n'` (trigger parts, lorebook text), `'\n\n---\n\n'` (greetings), `', '` (tags), `'\n'` (scripts list).
- Phase strings passed to `onPhase`: `'fetching metadata'`, `'loading tokenizer'`, `'separating'`, `'importing character'`, `'rebuilding lorebook (LLM)'`, `'saving lorebook'`.
- i18n keys for the notification: `notification_extracting`, `notification_importing`; notification title literal `'Glaze'`.
- Logs: `[janitor-extractor] meta fetch failed: `, `[janitor-extractor] lorebook rebuild failed: `.
- Lorebook name template: `'<name> — Closed Lorebook'` (U+2014 em dash).
- Fallbacks: `'Unknown'` (name), `''` (creator/creatorId).

## State machine, retries, timings

This file owns no timers, retries or backoff. What it does own:

- The proxy WebView is asserted active (`setActive(true)`) for the entire capture and released in `finally`; a second `setActive(false)` schedules a 45 s idle teardown (proxy constant `_idleShutdownGrace`).
- A foreground work hold is acquired for `extract` and again for `commit`; both are released in `finally`, and a hold failure is not caught here (the proxy catches its own queue hold failures, not this one).
- Capture-level timings live in the proxy and gate the behaviour our port has to match: probe send timeout `60s`, trigger send timeout `120s`, poll interval `700ms`, composer-ready poll `400ms` with a `60s` deadline, lore-cap splitting up to `_maxSplitPasses = 16` follow-up passes each `120s`, admission wait `_waitLimit = Duration(minutes: 20)`.
- Retry semantics that shape this file's inputs: a `403`/`401`/rate-limited `/generateAlpha` becomes `JanitorRefusedException` and is remembered per character id unless `isTransient` (`408`, `429`, `502`, `503`, `504`); a `401` becomes `JanitorAuthException` and is never cached. `extract` propagates these; it does not retry.

## Errors and user-visible messages

- `Exception('No character id found in: $input')` — no UUID in the URL.
- `JanitorRefusedException.proxyForbidden()` → status `403`, message `Proxies are forbidden for this character` (JanitorAI's own wording). Raised before any WebView work when `allow_proxy == false`.
- Metadata failure is silent to the user (`debugPrint` only); downstream this degrades to `'Unknown'` name, empty tags, no avatar, no catalog context.
- Lorebook rebuild failure surfaces as `CommitResult.lorebookError`, produced by `describeCatalogError(e, fallback: CatalogErrorSource.provider).inline` (text defined in `services/catalog_error_labels.dart`).
- `debugPrint` messages above are developer-only.

## Persistence

Nothing written by this file except through injected providers: `catalogProvider.importCharacter(...)` (character row + avatar fetch/save; `attachLorebooks` re-scopes public books) and `lorebooksProvider.put(lorebook)` (a lorebook row scoped by `characterId`). No cache lifetimes, no tokens, no prefs keys. `JanitorLoreBudget.load()` caches the tokenizer file in the app data dir (see `janitor_lore_budget.dart`), not here.

## Porting notes for our SillyTavern port

Reproduce literally:
1. **Field provenance order.** Card/scenario/example/first-message come from the probe (`"."`) payload, *not* the trigger payload; the trigger payload only supplies closed-lorebook text and the assistant greeting fallback. Getting this backwards imports triggered lore into `description`.
2. **Trigger text order and defaults.** `catalog = true`, `scenario = true`, `card = true`, `greetings = false`, `lorebookDescs = false`, joined with blank lines into one user turn. This is the lever that decides how many entries fire.
3. **Public-content subtraction.** `publicEntryContents(publicBooks)` (+ caller-supplied extras) must be subtracted before the text is ever treated as closed lore, otherwise public books are re-imported as "hidden" lore.
4. **Macro restoration before all comparisons.** `macro()` is applied to the separator output *and* to every `PromptFields` read, so captured (name-expanded) text lines up with catalog metadata (macros intact). `restoreMacros` skips names shorter than 3 chars and sorts longest-first.
5. **`withoutInjected` after the scan**, per field, so nothing reaches the prompt twice (once always-on).
6. **`_buildCatalogContext` wording** if we want the same LLM output; the "titles only — contents are hidden" line is part of the key-inference prompt.
7. **`_htmlToText` order** (tags then entities; `\n{3,}`→`\n\n`; `[ \t]+`→space) — used for `creatorNotes`, catalog/scenario context and greetings; a different order changes card text.

Dart-only scaffolding (skip): the `Ref`/Riverpod providers, `GenerationNotificationService` work holds, `debugPrint`, `onPhase` callback plumbing, `easy_localization` `.tr()` keys, `@visibleForTesting` hooks in other files.

Fragile / worth hardening in our port:
- `_parseCharacterId` accepts a UUID anywhere in the URL; a URL with two UUIDs (e.g. a query param) picks the first.
- `meta?['avatar'] as String?` hard-casts; a numeric or map avatar crashes the whole extraction instead of falling back.
- `indexOf`-style matching of `scripts[].type` is exact (`'lorebook'`/`'advanced'`); a new type silently drops the book from context.
- The metadata fetch is best-effort, so a CF/challenge blip yields a card called `Unknown` with no tags and no avatar rather than an error — in our extension, prefer surfacing a warning.
- `extractCharName` is evaluated twice per run (harmless, but a hint the code was iterated).

## Open questions

- Whether `importCharacter` persists `janitorMeta` into the character row (and under which key) — not determined from this file; `features/catalog/catalog_provider.dart` `importCharacter` body would settle it.
- What `describeCatalogError(...).inline` actually renders for a lorebook failure — `services/catalog_error_labels.dart`.
- Whether `rebuildLorebookWithActiveLlm` splits long text into parts and how `partCache`/`onProgress` behave — `services/janitor_lorebook_rebuilder.dart` (only its signature was read).
