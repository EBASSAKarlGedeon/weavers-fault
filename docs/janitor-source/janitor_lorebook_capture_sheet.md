# janitor_lorebook_capture_sheet.dart

- **Path:** `C:/Users/Gedeon/Documents/Coding/Glaze-stable/lib/features/catalog/widgets/janitor_lorebook_capture_sheet.dart`
- **Lines:** 2414 (read in full, 1–2414)
- **Role:** The whole lorebooks import surface — a Flutter port of JAR's `#tabLorebook` — owning the 4-stage capture/build/save state machine, both six-source context selections, public-book download/convert/bulk-save, and the `.txt` / World Info `.json` exports.

## Purpose

Opened by `showJanitorLorebookCaptureSheet(context, args:, characterId:, pendingCharacter:)` when the import flow picks "Lorebooks" or "Character + lorebooks". `JanitorLorebookArgs` = `{characterId, sourceUrl, meta, definitionPublic}`; `meta` is the raw `/hampter/characters/{id}` JSON and is the only input for public-book discovery, the pre-capture context preview, and the `allow_proxy` gate.

Two recoveries, kept strictly apart:

1. **Public lorebooks** from `meta['scripts']`: plain ones download whole (1:1 map); "advanced" ones ship JavaScript and are rebuilt by the LLM.
2. **Closed (private) lorebooks**: recoverable only by capturing the assembled `generateAlpha` prompt through the signed-in Janitor.AI WebView, then rebuilding the isolated text into keyed entries with the user's LLM.

Save scoping is decided downstream, not here: `characterId != null` → character-scoped; `null` → saved off (`enabled: false`, `activationScope: 'global'`).

## Behaviour walkthrough

**`showJanitorLorebookCaptureSheet`** — `showGlazeSheet<void>`, `useRootNavigator: true`, `isScrollControlled: true`, **`enableDrag: false`**, `backgroundColor: Colors.transparent`, `barrierColor: Colors.black54`. Drag is off deliberately: the modal's own drag pops past the confirm guard, while `SheetView`'s internal drag goes through `confirmDismiss`.

**`JanitorPendingCharacter {phase, result}` / `JanitorImportedCharacter {characterId, extraction}`** — the character half of "Character + lorebooks", handed in while it runs. `phase` is a `ValueListenable<String?>` of raw extractor phases. `extraction` is a capture the import already ran; the sheet reuses it instead of forcing a second one, because a capture mutates the JanitorAI account (preset, generation settings, a chat, a persona).

**`_ContextSources`** — six booleans, built twice with different defaults: `_extractSources = _ContextSources()` → `card: true, catalog: true, scenario: true, greetings: false, extra: false, lorebookDescs: false`; `_buildSources = _ContextSources(lorebookDescs: true)`. `copyFrom` copies all six. The one differing default is intentional — lorebook descriptions summarise the very entries being keyed: good reading for keys, a poor trigger.

**`initState`** — `_loadPublic()`; with a `pendingCharacter`, `phase.addListener(_onCharacterPhase)` and `result.then(_onCharacterImported, onError: ...)` where the handler only pops the sheet (the caller owns the import and reports the failure).

**`_onCharacterImported`** — `_characterId = imported.characterId`; `_importingCharacter = false`; `_importCapture = capture != null && capture.hasLorebook ? capture : null`; auto-name `'${capture.character.charData.name} — Closed Lorebook'` (U+2014) when the field is empty; `_maybeShowCaptureTour()`.

**`_loadPublic`** — `await fetchPublicLorebooks(widget.args.meta)` → `_public`, `_loadingPublic = false`, tour.

**`_maybeShowCaptureTour`** — early-returns while `_loadingPublic || _importingCharacter`; else post-frame `maybeShowGuide(context, AppGuide.lorebookCapture)` (deferred so the anchors are laid out).

**`_downloadPublic(book)`** — two-item sheet: Save (`catalog_lorebooks_save`/`_save_sub`, `bookmark_add_outlined`) → `_saveLorebook(book.toLorebook(characterId: _characterId))`; Export (`catalog_lorebooks_export`/`_export_sub`, `download_outlined`) → `_exportJson(book.toTavernJson(), book.title.isNotEmpty ? book.title : 'lorebook')`. Either success → `_markDownloaded(book.id)`. Guarded by `if (_savingAll) return;`.

**`_markDownloaded`** — adds to `_downloadedIds`, recomputes `_allDownloaded = _everythingDownloaded`, and if so pops after `Duration(milliseconds: 1600)`.

**`_everythingDownloaded`** — `!_loadingPublic && _closedBooks.isEmpty && books.isNotEmpty && books.every((b) => _downloadedIds.contains(b.id))` over `_downloadableBooks`.

**`_downloadJs(book)`** — if `_convertedScripts[book.id]` exists, re-offer destinations without a second rebuild. Else an explainer sheet (`catalog_lorebooks_scripted_title` + `BottomSheetBigInfo(icon: code_rounded, description: _scripted_desc, buttonText: _scripted_btn)`) whose button pops then calls `_buildJs`.

**`_buildJs`** — `_jsBuildingId = book.id`; `buildLorebookFromJs(jsSource: book.jsSource, name: book.title.isNotEmpty ? book.title : 'Janitor Lorebook', meta: widget.args.meta, characterId: _characterId)`; `_convertedScripts[book.id] = lb`; `_offerSaveExport(lb, publicId: book.id)`. Failure → toast `catalog_lorebooks_build_failed` with `describeCatalogError(e, fallback: CatalogErrorSource.provider).inline`.

**`_downloadAllPublic`** — refuses while `_savingAll || _jsBuildingId != null`. Iterates `_downloadableBooks` (JSON first, then scripts; scripts reuse `_convertedScripts`). Per book: `if (!mounted) return;` before the write, `addLorebook(lb)`, then `if (book.isJs) _convertedScripts[book.id] = lb; _delivered = true; _downloadedIds.add(book.id); saved++`. Throws are caught per book (`debugPrint('[janitor-lorebook] save-all ${book.id} failed: $e');`) and collected as `book.title.isEmpty ? book.id : book.title` — one failure never aborts the batch. Finish: if `failed.isEmpty && _everythingDownloaded` → `_markDownloaded(books.last.id)` and return **without a toast** (the "all downloaded" screen says it); else toast `_saved_all` or `_saved_all_partial`.

**`_publicScriptContents`** — `_convertedScripts.values.expand((b) => b.entries).map((e) => e.content.trim()).where((c) => c.isNotEmpty).toList()`. The accounting trick: a public script's entries cannot be subtracted from the closed capture until converted, so they would otherwise land in both sections.

**`_withoutPublicScripts(text)`** — `withoutPublicEntries(text, _publicScriptContents)` (defined in `janitor_separate.dart`). Applied at **read** time everywhere the extracted text is used (display, build, preview, `.txt`), never written back — so converting one more script needs no re-capture.

**`_offerSaveExport(book, {publicId})`** — shared destinations for built JS books and DataCat results: Save → `_saveLorebook(book)`; Export → `_exportJson(glazeLorebookToTavernJson(book), book.name)`.

**`_saveLorebook`** → `addLorebook`, `_delivered = true`, toast `_saved` with `[book.name, '${book.entries.length}']`; returns bool.

**`_exportJson(json, name)`** — filename = name with `RegExp(r'[^\w\- ]+')` stripped, trimmed; empty → `'lorebook'`; writes `'${safe}.json'` via `FileExportService.export(..., subfolder: 'Lorebooks')`, `JsonEncoder.withIndent('  ')`. `path.isEmpty` = dialog cancelled (false, no toast, `_delivered` untouched).

**`_extractAll`** — the capture. One action for *all* closed books because the capture assembles the character's whole prompt; per-book capture is impossible. Clears `_extractError`, `_extractPhase`, `_extraction`, `_built`, `_buildError`, `_buildDebug`, `_buildPartCache.clear()`. Calls `extract(widget.args.sourceUrl, extraPublicContents: _publicScriptContents, trigger: JanitorTriggerContext(card, catalog, scenario, greetings, lorebookDescs, extra: _extractSources.extra ? _extractExtraController.text.trim() : ''), onPhase: ...)`. On success it **carries the extraction choice into the build** — `_buildSources.copyFrom(_extractSources)`, `_buildExtraController.text = extra` (JAR's `runLoreExtract`), still editable. On `JanitorAuthException` it drops the account (`setUserName(null)`) so the sheet asks for a login instead of offering a capture that cannot run. Failure → `describeCatalogError(e, fallback: CatalogErrorSource.janitor)`.

**`_build`** — starts a 1 s periodic timer incrementing `_elapsed`; `buildLorebook(lorebookText: _withoutPublicScripts(ex.lorebookText), name: <field or '${name} — Closed Lorebook'>, <six contexts gated by _buildSources>, characterId: _characterId, onProgress: (done, total) { if (total > 1) _buildProgress = (done, total); }, partCache: _buildPartCache)`. Errors → `describeCatalogError(e, fallback: CatalogErrorSource.provider)` and `_buildDebug = e is LorebookBuildException ? e : null`. `finally` cancels the timer and clears `_buildProgress`.

**`_named(book)`** — applies the name field unless empty or unchanged.

**`_preview`** — `planLorebookBuild(_withoutPublicScripts(ex.lorebookText), config: resolveLorebookBuildConfig(...), chunkTokens: settings?.lorebookBuildChunkTokens ?? kDefaultLorebookBuildChunkTokens, systemPrompt: lorebookSystemPrompt(settings), <same six contexts>)` → `showJanitorPromptPreviewSheet(context, requests.first, requestCount: requests.length)`. Same split, same system prompt as the real build, so the preview is truthful.

**`_downloadExtracted`** — no-LLM escape hatch: `_withoutPublicScripts(ex.lorebookText).trim()` verbatim as `.txt`; empty → toast `_nothing_to_download`; default name `'${ex.character.charData.name} — Closed Lorebook (extracted)'`.

**`_hasFlow`** — `!_loadingPublic && _closedBooks.isNotEmpty && _source == ExtractionSource.local`. DataCat has no stages.

**`_phase`** (derived, never stored) — `_importingCharacter → character`; `!_hasFlow → collect`; `_built != null → save`; `_extraction != null → build`; else `collect`.

**`_confirmClose`** — `true` when `_delivered`; else a sheet (`_close_title` + `BottomSheetBigInfo(icon: warning_amber_rounded, description: _close_desc)`) with `btn_close` (`isDestructive: true, centered: true`, pops `true`) and `btn_cancel` (pops `false`).

**`_onFirstStage`** — `phase == character || phase == collect`. `_stepBack()` → `_restartBuild()` if `_built != null` else `_restartCollection()`.

**`build`** — `SheetView` with title row (`catalog_lorebooks_title` + `HelpTip(term: 'janitor-extraction', size: 18)`), `startExpanded: true`, `canPop: _onFirstStage && _delivered`, `confirmDismiss: _confirmClose`, `onBack:` → first stage `_close()`, else `if (_building || _extracting) return;` then `_stepBack()`; one action (`Icons.tune_rounded`, tooltip `catalog_extraction_settings_title`) → `showJanitorExtractionSettingsSheet(context)`; `headerBottom: _hasFlow || _importingCharacter ? _phaseStrip(cs) : null`. Body is an `AnimatedSwitcher` over `_allDownloaded → _AllDownloaded`, `_importingCharacter → _CharacterImporting`, `_loadingPublic → _SheetLoading`, else `_list()`.

**`_list` / `_stageContent`** — `ListView` whose single child is an `AnimatedSwitcher` keyed by `_phase`, with a `layoutBuilder` stacking the outgoing stage top-anchored and unconstrained so the sheet takes the arriving stage's height. `collect` → `GuideAnchor(GuideIds.lorebookCapturePublic)` around `_PublicSection`, plus when closed books exist `_closedSection` (local) or `_datacatSection` (datacat). `build` → `_buildBlock`; `save` → `_buildResult`.

**`_phaseStrip`** — stage labels joined by `chevron_right_rounded`; the back arrow takes zero width on the first stage (`AnimatedSwitcher` + `SizeTransition`), disabled at alpha 0.3 while `_building || _extracting`; current label `w700` + `cs.primary`, passed alpha 0.7, future 0.35. The `character` stage is listed only when `pendingCharacter != null`.

**`_closedSection`** — collapsible `catalog_lorebooks_closed · N` (`helpTerm: 'janitor-closed-lorebook'`) with `_closed_hint_many` (with count) or `_closed_hint_one` plus one `_ClosedRow` each; `_extractContextGroup()`; `GuideAnchor(GuideIds.lorebookCaptureCollect)` around the single primary `ActionTile(Icons.auto_fix_high_rounded, busy: _extracting)` labelled with the live phase (`janitorPhaseLabel(_extractPhase)`) or `_extracting`, tap = `_canRebuild ? _extractAll : null`; `_buildExtractStatus`; then the import-capture shortcut.

**`_importCaptureShortcut`** — `_import_capture_note` (token estimate) + `ActionTile(Icons.fast_forward_rounded, _use_import_capture)` → `_useCapture(capture)`: sets `_extraction = capture`, clears `_extractError`, auto-names. It does **not** `copyFrom`, so `_buildSources` keeps its defaults.

**`_datacatSection`** — same list with `_datacat_hint`, then a primary `ActionTile(Icons.pets_outlined)` (`_datacat_btn` / phase / `_datacat_fetching`), then an error hint.

**`_fetchDatacatLorebook`** — `datacatExtractAndPoll(sourceUrl, onPhaseChange: ...)` → `datacatPhaseLabel`; `res.error` → hint; `res.charData?.characterBook is! Map` → `_datacat_none`; else `convertCharacterBook(book, _characterId ?? '')`, empty entries → same message; else `_offerSaveExport(converted.copyWith(enabled: false, activationScope: _characterId != null ? 'character' : 'global', activationTargetId: _characterId))`. Silent on success — the destination sheet is the feedback.

**`_restartCollection` / `_restartBuild`** — state resets only (drop `_extraction`/`_built`/errors; `_restartBuild` keeps `_extraction`). Neither re-runs the capture: coming back exists precisely to change what is sent.

**`_buildExtractStatus`** — hint precedence `_proxyForbidden` (`'${JanitorRefusedException.proxyForbidden().message}. ' + 'catalog_janitor_refused_body'`) > not local (`_need_optin`) > not logged in (`_need_login`) > none; then `GlazeErrorBlock(message, label)` for `_extractError`.

**`_buildBlock`** — group `_build_title` (`helpTerm: 'lorebook'`), description `_build_extracted` (token count) or `_build_none`; `DisclosureRow(_extracted_content/_sub, content: loreText)`; `_GroupNote(_injected_note, args: ['${ex.injected.length}'])` when the field diff recovered fragments; `MenuItem(_download_txt/_sub)`. If `hasLore`: `_keyContextGroup(ex)`, a `Wrap` of Build (`auto_awesome_rounded`, primary, busy) and Preview (`visibility_outlined`) `ActionTile`s, the `_build_patience` line with `schedule_rounded`, the error block, `_LlmDebugPanel`.

**`_buildResult`** — group `_built` (entry count) with `MenuFieldItem(_world_name, controller: _nameController, placeholder: book.name)`, Save → `_saveLorebook(_named(book))`, Export → `_exportJson(glazeLorebookToTavernJson(named), named.name)`; then a mono `ContentPane(maxHeight: 220)` of the exact export JSON.

**`_extractContextGroup`** — group `_extract_title` (`helpTerm: 'janitor-extract-context'`, description `_extract_hint`). Card preview `(_extraction ?? _importCapture)?.cardContext ?? ''` with `emptyNote: catalog_ctx_card_pending` and `pending` while nothing is captured — selectable anyway, because the first send reveals the card in time; catalog/scenario from `_previewCtx`; greetings prefer `_previewCtx.greetings` then the capture's `greetingsContext` (`catalog_ctx_greetings_pending`); lorebook descriptions from `buildLorebookDescsContext(_public)` (live list, not the capture). `extra` is a `MenuSwitchItem` (`catalog_ctx_extra/_desc`) revealing `MenuFieldItem(maxLines: 4, placeholder: catalog_ctx_extra_ph)`.

**`_keyContextGroup(ex)`** — group `_key_context_title` (`helpTerm: 'lorebook-key-context'`, description `_key_context_hint`); all six from `ex.*Context`; `extra` gated on `_buildSources.extra`.

**Sub-widgets** — `_CharacterImporting` (spinner, `_character_importing`, `'$step…'`, `_character_importing_hint`), `_SheetLoading`, `_AllDownloaded` (badge `Interval(0, 0.7, elasticOut)`, text `Interval(0.3, 0.8, easeOutCubic)` slid from `Offset(0, 0.4)`), `_ClosedRow`, `_GroupNote` (`Color(0xFF99A2AD)`), `_LlmDebugPanel`, `_Hint`.

**`_PublicSection`** — splits via `publicJsonBooks`/`publicJsBooks`; both empty with closed present → `SizedBox.shrink()` (the closed section carries the messaging), else `_none`. `split = json.isNotEmpty && js.isNotEmpty` → `_group_books`/`_group_scripts` + `_group_scripts_note`, else flat. Note = `' '.join` of `_public_hint`, `_public_hint_closed` (closed exist), `_public_hint_scripted` (scripts exist and `!split`). Header `'${'catalog_lorebooks_public'.tr()} · ${json.length + js.length}'`. Bulk `ActionTile(library_add_rounded)` appears **only from two books up** (`_download_all_busy` `done/total` or `_download_all` `count`), disabled when `buildingId != null`.

**`_PublicRow`** — label `book.title.isEmpty ? 'Lorebook' : book.title`; subtitle = kind line (`catalog_lorebook_kind_scripted`, or `_kind_public` with `entryCount`) + `'\n'` + trimmed description; trailing: `downloaded && !building` → `check_circle_rounded`, else `isJs` → compact primary `ActionTile(auto_fix_high_rounded, _convert_btn, busy: building)`, else an 18×18 spinner when `building` (unreachable — non-JS rows never set it) (inferred), else `download_rounded`. `onTap: building ? () {} : (onDownload ?? () {})`.

**`_PromptPreviewSheet`** — non-expanded sheet `_prompt_preview`; one action copies `messages.map((m) => '### ${m['role']}\n${m['content']}').join('\n\n')` with toast `chat_copied`; `_GroupNote(_preview_parts)` when `requestCount > 1`; one `MenuGroup` per message (header `m['role']`, description `catalog_ctx_tokens`); body `SelectableText(fontSize: 11, height: 1.45, fontFamily: 'monospace')`.

## Data shapes

- `JanitorLorebookArgs {String characterId; String sourceUrl; Map<String, dynamic> meta; bool definitionPublic}`.
- `PublicLorebook {id, title, description, accessible, entryCount, rawEntries, error, isJs, jsSource}` + `toLorebook({characterId})`, `toTavernJson()`.
- `ExtractionResult {characterId, sourceUrl, character, lorebookText, entryBlockCount, cardContext, catalogContext, injected, scenarioContext, greetingsContext, lorebookDescsContext}` + `bool get hasLorebook`.
- `JanitorTriggerContext {bool card, catalog, scenario, greetings, lorebookDescs; String extra}` — defaults `true, true, true, false, false, ''`.
- `InjectedBlock {InjectionField field; String text}`.
- `Lorebook {id, name, enabled, activationScope, activationTargetId, entries, settings, description, updatedAt}`.
- `LorebookEntry {id, comment, enabled, constant, keys, secondaryKeys, selectiveLogic, content, position, order, scanDepth, caseSensitive, matchWholeWords, probability, preventRecursion, sticky, cooldown, delay, group, …}` — defaults `selectiveLogic: 5`, `position: 'matchGlobal'`, `order: 100`, `probability: 100`.
- `LabeledError {CatalogErrorSource source; String message}` + `label`, `inline` (`'$label: $message'`).
- `LorebookBuildException {message, source, rawText, reasoning, rawResponseJson, cause}`.
- `(int, int)? _buildProgress` = `(done, total)`; `Map<String, List<LorebookEntry>> _buildPartCache` keyed `[config.id, config.model, ...contents].join('\u0000')` (built in the rebuilder).

## Network / WebView contract

No HTTP happens in this file; it composes calls whose contracts live elsewhere (listed so the port doesn't hunt for URLs here):

- `fetchPublicLorebooks(meta)` → per `meta['scripts']` with `type` in `{'lorebook','advanced'}` and non-null `id`: `GET https://janitorai.com/hampter/script/{id}` plus `https://janitorai.com/scripts/{id}` for the real description, both through `JanitorWebViewProxy.instance.fetch(...)`. `accessible` requires ≥1 entry with non-empty `content`; a `script` string that doesn't parse as a JSON array becomes `isJs: true` with `jsSource` = that string.
- `JanitorExtractor.extract(sourceUrl, trigger, onPhase, extraPublicContents)` → throwaway preset/chat/persona on Janitor.AI, intercepting `/generateAlpha`; the six trigger booleans are exactly `_extractSources`.
- `buildLorebookFromJs` / `buildLorebook` → the user's LLM; this file supplies only the six context strings, `partCache`, `onProgress`.
- `datacatExtractAndPoll(sourceUrl, onPhaseChange)` → DataCat REST, read as `res.error`, `res.charData?.characterBook`.
- `lorebooksProvider.notifier.addLorebook(Lorebook)` — local only.

## Selectors, regexes and string literals

Owned here — the only two regexes, identical filename sanitisers: `RegExp(r'[^\w\- ]+')` in `_exportJson` and `_downloadExtracted`.

Other literals owned here:

- Names: `'${capture.character.charData.name} — Closed Lorebook'`, `'${ex.character.charData.name} — Closed Lorebook'`, `'${ex.character.charData.name} — Closed Lorebook (extracted)'`, `'Janitor Lorebook'` (JS fallback, `_buildJs` and `_downloadAllPublic`), `'lorebook'` (empty-title export fallback), `'Lorebook'` (`_PublicRow`/`_ClosedRow` empty titles).
- Files: `'${safe.isEmpty ? 'lorebook' : safe}.json'`, `'${safe.isEmpty ? 'lorebook' : safe}.txt'`, subfolder `'Lorebooks'`, `JsonEncoder.withIndent('  ')`.
- Labels: `'${'catalog_lorebooks_closed'.tr()} · ${closed.length}'`, `'${'catalog_lorebooks_public'.tr()} · ${json.length + js.length}'`, separator `' · '`, subtitle join `'\n'`, note join `' '.join(...)`.
- Preview: `'### ${m['role']}\n${m['content']}'` joined by `'\n\n'`; debug header `'$label · ${'catalog_ctx_tokens'.tr(args: ['${estimateTokens(body)}'])}'`.
- Debug labels, hardcoded English and **not** localised: `'Raw provider payload'`, `'Assistant text'`, `'(empty)'`, `'Reasoning stream'`, `'Copy'`, `'Copied $label'`.
- Glossary terms: `'janitor-extraction'`, `'janitor-closed-lorebook'`, `'janitor-extract-context'`, `'lorebook-key-context'`, `'lorebook'`.
- Guides: `AppGuide.lorebookCapture`, `GuideIds.lorebookCapturePublic`, `GuideIds.lorebookCaptureCollect`, `GuideIds.lorebookCaptureExtract`.
- `'…'`, `'$step…'`; log line `debugPrint('[janitor-lorebook] save-all ${book.id} failed: $e');`.

## State machine, retries, timings

Stages `enum _Phase { character, collect, build, save }` (`catalog_lorebooks_phase_*`), derived from state so any failure rolls the UI back by clearing `_built`/`_extraction`. `!hasFlow` pins the sheet to `collect` permanently (DataCat, or no closed books).

Guards: `_extracting` blocks `_extractAll` and the back arrow; `_savingAll` blocks per-row actions and the bulk run; `_jsBuildingId != null` blocks the bulk button (one rebuild at a time); `_delivered` is the only way closing becomes silent — `canPop: _onFirstStage && _delivered`.

Timings, all literal: auto-close `1600` ms; build timer `Timer.periodic(const Duration(seconds: 1))` cancelled in `finally`; body switch `260` ms; stage switch `240` ms; back-arrow switch `200` ms; stage label style `220` ms; `_AllDownloaded` controller `900` ms; importing-step switch `200` ms.

Retries: **none here.** Refresh-and-retry on 401 lives in `JanitorWebViewProxy`; `datacatExtractAndPoll` has `maxAttempts = 60` with a twice-seen-empty rule. The only retry-adjacent mechanism here is `_buildPartCache`, which lets a *manual* rebuild resume at the failed part instead of re-paying for earlier ones.

## Errors and user-visible messages

Exact English (`assets/translations/en.json`). Keys abbreviated after `catalog_lorebooks_`:

- Actions/progress: `extracting` = `Collecting entries…`; `collect_btn` = `Collect lorebook entries`; `build_btn` = `Build lorebook`; `preview_btn` = `Preview prompt`; `building` = `Building… {}s`; `building_parts` = `Building… part {} of {} — {}s`; `build_patience` = `Building a lorebook may take a while, please be patient.`
- Results: `build_failed` = `Build failed: {}`; `save_failed` = `Save failed: {}`; `export_failed` = `Export failed: {}`; `saved` = `Saved “{}” ({} entries)`; `saved_all` = `Saved {} lorebooks to Glaze`; `saved_all_partial` = `Saved {} of {} — failed: {}` (3rd slot = comma-joined failed titles/ids); `exported` = `Exported {}`; `nothing_to_download` = `No lorebook text to download.`
- Blocking hints, in precedence order: `Proxies are forbidden for this character. ` + `catalog_janitor_refused_body` = `Because of that, Glaze is unable to recover the character and its lorebooks (if it has them).`; `need_optin` = `Set “Extract JanitorAI cards with” to Local to rebuild closed lorebooks.`; `need_login` = `Log in to Janitor.AI (catalog menu) to rebuild.`
- `catalog_janitor_session_expired` = `Log into your Janitor.AI account again to import this character. The stored session is no longer accepted, so the capture cannot run.`
- `datacat_none` = `DataCat has no lorebook for this character. Private lorebooks are only recoverable with Local extraction.`; `datacat_hint` = `DataCat carries a character's public lorebooks only, so a private book is usually not there. Set “Extract JanitorAI cards with” to Local to rebuild one.`
- Close guard: `close_title` = `Are you sure?`; `close_desc` = `The lorebook hasn't been saved or exported yet. Closing now discards the extraction progress.`
- `none` = `No lorebooks attached.`; `all_downloaded` = `All lorebooks have been downloaded`; `loading` = `Loading lorebooks…`.
- `closed_hint_many` = `This character has {} closed lorebooks which need to be extracted. They will be merged into a single lorebook due to limitations of the extraction method.`; `closed_hint_one` = `This lorebook is closed. It can only be recovered by capturing the assembled prompt through your Janitor.AI session and rebuilding it into keyed entries with your active LLM.`
- `import_capture_note` = `The character import already collected entries with the default context ({} tok.). Collect again to use the context chosen above, or continue with those.`; `use_import_capture` = `Continue with entries from the import`; `injected_note` = `Includes {} fragment(s) recovered from the character's own fields — a lorebook wrote them into the scenario, the personality or the first message instead of adding them as entries.`
- Phase strings via `janitorPhaseLabel` (`janitor_phase_*`), e.g. `Getting the character card`, `Triggering entries, part {} of {}`, `Waiting in the JanitorAI queue ({})`.

## Persistence

- Books → `lorebooksProvider.notifier.addLorebook(...)` (local DB); no file writes for those.
- Exports → `FileExportService.export(data:, filename:, subfolder: 'Lorebooks')`, `.json` (World Info) and `.txt` (raw text); `''` = cancelled dialog = not delivered.
- In-memory, lifetime = one sheet: `_downloadedIds`, `_convertedScripts`, `_buildPartCache`, `_delivered`, `_extraction`, `_built`. Nothing survives reopening; public books are re-fetched every time.
- Account side effect: `setUserName(null)` on `JanitorAuthException`, clearing the `gz_janitor_user_name` pref.
- The capture mutates the Janitor.AI account (preset, generation settings, a chat, a persona) and restores it — the reason for the import-capture shortcut and the "coming back does not re-run the capture" rule.

## Porting notes for our SillyTavern port

1. **Port the derived stage machine, not a navigation stack.** `phase = f(state)` makes "back one step" free and stops a failure stranding the UI.
2. **Six sources × two selections, different defaults.** Extraction: card/catalog/scenario on, greetings/lorebook-descs off. Key inference: same but `lorebookDescs` on. After a successful capture the extraction choice is **copied over** the build choice — JAR parity; keep it, still editable.
3. **`extra` is free text behind a switch**, with two controllers; the extract text is copied into the build text on success.
4. **Card and greetings exist only after a capture.** Render them selectable-but-pending rather than disabled, or entries keyed only on card names can never fire. Pre-capture previews come from `contextFromMeta(meta)`; the card stays empty.
5. **Lorebook descriptions come from two sources on purpose**: pre-capture `buildLorebookDescsContext(_public)`, post-capture `ex.lorebookDescsContext`. Always using the live list makes preview and sent prompt disagree.
6. **Subtract public entries at read time**, never writing back into `extraction.lorebookText` — that is what makes "convert one more script" free. Matching rules: whitespace runs match any whitespace, `'‘’ʼ` interchangeable, `"“”` interchangeable, `-–—` interchangeable, needles under 12 chars skipped.
7. **Classify by `accessible`/`isJs`, not `is_public`**: closed = `!accessible && !isJs`; public JSON = `accessible && !isJs`; scripts = `isJs`. `accessible` means "≥1 entry with non-empty `content`" — a `is_public: false` script that downloads is still public here (inferred). `lorebookScriptRefs`'s `isPublic` is fetched and unused.
8. **Bulk policy**: JSON then scripts; per-book try/catch; failures collected as titles; never abort; toast distinguishes all-saved from partial; when everything succeeded and nothing is closed, suppress the toast and let the "all downloaded" screen speak.
9. **Two closing guards**: `_delivered` and the confirm sheet. In a DOM panel that maps to a confirm on panel close/tab switch plus holding Back/Escape while a build runs.
10. **The export shape is already SillyTavern World Info** — `{name, entries: {"0": {…}}}` with `position` `worldInfoBefore → 0`, `lorebooksMacro → 4`, else `1`, `depth: 4`, `selective: !constant`, `displayIndex`, `addMemo: true`, `useProbability: true`, `characterFilter: {isExclude: false, names: [], tags: []}`. Drop the intermediate Glaze `Lorebook` layer, but mind the `selectiveLogic` discrepancy: `_toEntry` defaults `5`, the tavern export defaults `0`.
11. **Split builds**: `planLorebookBuild` returns one message list per chunk; `partCache` keys include `config.id` and `config.model`, so a model switch invalidates cached parts. The preview must compute the *same* request list (same `resolveLorebookBuildConfig`, same `lorebookSystemPrompt`) or it lies. Progress arithmetic is `min(done + 1, total)` — 1-based display.
12. **DataCat has no stages** — one request, no phase strip, and the book is force-set to `enabled: false` with `character`/`global` scope before destinations are offered.

## Open questions

- Whether `addLorebook` dedupes or reactivates a same-name book — `lib/core/state/lorebook_provider.dart`. Decides whether re-running the bulk action duplicates the library.
- `FileExportService.export` cancel semantics beyond the comment `// user cancelled the save dialog` — `lib/core/services/file_export_service.dart`.
- `SheetView.canPop` / `confirmDismiss` / `onBack` interaction for Escape and programmatic pop — `lib/shared/widgets/sheet_view.dart`.
- Whether DataCat's `charData.characterBook` is already Character-Book-shaped (input to `convertCharacterBook`) — `lib/features/catalog/services/datacat_provider.dart`.
- Where `args.meta` originates and whether it can be a partial/cached fetch — `janitorAllowsProxy` reads `meta['allow_proxy'] != false` (`janitor_provider.dart`). UNKNOWN — not determined from this file.
- Whether `estimateTokens` has a real BPE tokenizer loaded at this point (else it approximates) — `lib/core/llm/tokenizer.dart`.

## Context read

- `janitor_public_lorebook.dart` — `PublicLorebook`, the `/hampter/script/{id}` fetch, the closed/public/script predicates, `buildLorebookDescsContext`, `glazeLorebookToTavernJson`.
- `janitor_separate.dart` — `withoutPublicEntries` and `loosePattern` tolerance rules.
- `janitor_extractor.dart` — `ExtractionResult`, `JanitorTriggerContext`, `contextFromMeta`, build signatures.
- `janitor_lorebook_rebuilder.dart` — `planLorebookBuild`, `lorebookSystemPrompt`, `partCache` keying, `LorebookBuildException`.
- `catalog_error_labels.dart` — `LabeledError`, `describeCatalogError`.
- `janitor_phase_label.dart` — raw phase → user string table.
- `janitor_build_widgets.dart` — `ContextSourceTile` locked/pending/empty semantics.
- `janitor_extraction_settings_sheet.dart` — what the header gear opens.
- `janitor_provider.dart` — `janitorAllowsProxy`.
- `janitor_webview_proxy.dart` — `JanitorAuthException`, `JanitorRefusedException.proxyForbidden()`.
- `janitor_account_provider.dart` — `isLoggedIn`, `setUserName(null)`, `gz_janitor_user_name`.
- `app_settings_provider.dart` — `ExtractionSource` (default `datacat`), `kDefaultLorebookBuildChunkTokens = 24000`.
- `core/models/lorebook.dart` — `Lorebook`/`LorebookEntry` fields and defaults.
- `assets/translations/en.json`, `glossary_en.json` — exact user-visible English strings.
