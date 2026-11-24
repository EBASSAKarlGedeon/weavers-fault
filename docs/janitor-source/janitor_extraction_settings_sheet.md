# janitor_extraction_settings_sheet.dart

- **Path:** C:/Users/Gedeon/Documents/Coding/Glaze-stable/lib/features/catalog/widgets/janitor_extraction_settings_sheet.dart
- **Lines:** 51 (read in full: 1-51)
- **Role:** The "Lorebook build settings" sheet opened by the gear in the lorebook capture sheet's header — a thin host that stacks the three settings groups (LLM connection, request splitting, system prompts) that decide *how* a closed or scripted lorebook is rebuilt into keyed entries.

## Purpose

Everything that changes the *behaviour* of the LLM rebuild lives one tap away from the flow that runs it. Header, verbatim: "Settings for the lorebook build, opened from the gear in the lorebook capture sheet's header. Everything that decides *how* a lorebook is rebuilt into entries lives here: the connection and model the build runs on, how a long extraction is split into requests, and the system prompts it is given. Keeping them one tap from the flow means a failed build can be corrected where it failed. The JanitorAI account and the extraction source are content-provider settings and stay on that screen."

That last sentence is the file's real content: it is a **scope statement**. Account and source are deliberately excluded; this sheet is only about the build.

## Behaviour walkthrough

`showJanitorExtractionSettingsSheet(BuildContext context)` — `showGlazeSheet<void>` with `useRootNavigator: true`, `isScrollControlled: true`, `backgroundColor: Colors.transparent`, `barrierColor: Colors.black54`, builder `const JanitorExtractionSettingsSheet()`. Same modal recipe as `janitor_extract_sheet.dart`; returns nothing.

`JanitorExtractionSettingsSheet` is a plain `StatelessWidget` (each child group is its own `Consumer` widget, so the sheet itself never needs to rebuild):

```
SheetView(
  title: 'catalog_extraction_settings_title'.tr(),   // "Lorebook build settings"
  startExpanded: true,
  body: Builder(builder: (inner) => ListView(
    padding: EdgeInsets.only(
      top: MediaQuery.paddingOf(inner).top + 12,
      bottom: MediaQuery.paddingOf(inner).bottom + 24,
    ),
    children: const [
      LorebookBuildLlmGroup(),
      LorebookBuildSplitGroup(),
      LorebookBuildPromptsGroup(),
    ],
  )),
)
```

- `startExpanded: true` — the sheet opens at full height rather than peeking, because it is a settings surface, not a confirmation.
- The `Builder` + `MediaQuery.paddingOf(inner)` pattern is for the nested-sheet case: inside a desktop floating window the sheet's own subtree is what carries the inset, not the root context.
- Children are `const` and **order matters for reading**: connection first (the thing that most often causes a failed build), then splitting, then prompts.

Only one call site: `widgets/janitor_lorebook_capture_sheet.dart:1046` (`onPressed: () => showJanitorExtractionSettingsSheet(context)` in the header gear).

## Data shapes

The sheet owns no state; each group binds to `AppSettings` fields in `features/settings/app_settings_provider.dart`:

| Group | Widget | Setting key(s) | Default | Effect |
|---|---|---|---|---|
| LLM | `LorebookBuildLlmGroup` | `lorebookBuildApiConfigId` (`String`), `lorebookBuildModel` (`String`) | `''`, `''` | Empty connection = the build uses **the chat's active connection** ("Left on the chat connection, builds use whichever LLM is selected."). Changing the connection clears the model override, because "A model picked against the previous connection would not resolve on the new one". |
| Split | `LorebookBuildSplitGroup` | `lorebookBuildChunkTokens` (`int`) | `kDefaultLorebookBuildChunkTokens = 24000` | `0` means "don't split" (one request, whatever the length). The switch writes `kDefaultLorebookBuildChunkTokens` when turned on and `0` when turned off. |
| Prompts | `LorebookBuildPromptsGroup` | `lorebookBuildPrompt`, `lorebookBuildPromptJs` (`String`) | `''`, `''` | `''` means "use the built-in prompt", so the default wording keeps tracking future releases instead of being pinned by an accidental edit. |

Rebuild-side consumers (other files, for the porting picture): `rebuildLorebookWithActiveLlm` reads `settings.lorebookBuildChunkTokens` into `chunkTokens` (`services/janitor_lorebook_rebuilder.dart:488`); `lorebookSystemPrompt(settings)` / `lorebookSystemPrompt(settings, fromJs: true)` feed the two prompt fields; `lorebookBuildChunkBudget(config, fixedTokens:, maxTokens:)` clamps the per-request size.

## Network / WebView contract

No network of its own — but the LLM group is the *only* place that decides which API config a build talks to. `ApiSlotGroup` (from `features/settings/widgets/api_slot_group.dart`) renders the connection picker and one `ApiSlotModelRow`, writing through `appSettingsProvider`. Builds run against the user's own provider (OpenAI-compatible etc.), not against JanitorAI; the JanitorAI WebView is irrelevant to every setting on this sheet.

## Selectors, regexes and string literals

No regexes or selectors. Literals defined here: `'catalog_extraction_settings_title'` (= `"Lorebook build settings"`), `startExpanded: true`, padding `+ 12` top / `+ 24` bottom, `barrierColor: Colors.black54`.

Literals the children contribute (from `lorebook_build_settings.dart`, quoted for the settings catalogue rather than for this file's own text):

- `lorebook_build_llm_title` = `"Lorebook build LLM"`; `lorebook_build_llm_desc` = `"The connection and model that rebuild lorebooks into entries with keys: closed JanitorAI lorebooks and scripted ones. Left on the chat connection, builds use whichever LLM is selected."`
- `catalog_extraction_split_title` = `"Long lorebooks"`; `catalog_extraction_split_hint` = `"The model writes every entry back out in full, so its reply is as long as the extracted content. Content longer than one request is built in parts, one request after another, each with the same context."`
- `catalog_extraction_split_toggle` = `"Build in several requests"`; `catalog_extraction_split_toggle_desc` = `"Off sends all the extracted content in one request, however long."`
- `catalog_extraction_split_tokens` = `"Content per request"`; `catalog_extraction_split_tokens_desc` = `"In tokens. Keep it under your model's output limit. Also capped at half of the connection's context size."`
- `catalog_extraction_settings_prompts` = `"Lorebook build prompt"`; `..._hint` = `"The system prompt your LLM is given when it rebuilds captured text into keyed entries. Edits apply to the next build; “Preview prompt” shows exactly what gets sent."`
- `catalog_extraction_prompt_main` = `"Build prompt"`; `catalog_extraction_prompt_js` = `"Scripted (advanced) build prompt"`; `catalog_extraction_prompt_reset` = `"Reset prompts to default"`; `catalog_extraction_prompt_reset_sub` = `"Restores both built-in prompts"`; `catalog_extraction_prompt_reset_done` = `"Build prompts reset to default"`.
- Numeric constants: `_maxTokens = 128000` ("Past this the reply alone outgrows the output limit of nearly every provider"), `kMinLorebookBuildChunkTokens = 2000`, slider `divisions: (128000 - 2000) ~/ 1000 = 126`, `decimalPlaces: 0`, `editableValue: true`.

## State machine, retries, timings

- Every control writes immediately; there is **no Save button and no discard**. Closing the sheet commits what you typed.
- The prompt fields debounce: `Timer(const Duration(milliseconds: 600), _writePrompts)`, and `dispose()` flushes a pending edit ("closing the screen right after typing must not drop the last keystrokes"). Prompt writes re-read the latest settings before saving (`_latest`, captured at build time) so a concurrent change is preserved — unlike `janitor_source_settings.dart`, which saves a stale snapshot.
- A field left exactly at the built-in default is persisted as `''` so the setting keeps tracking upstream default wording; `_resetPrompts()` writes the built-in text then saves immediately with `catalog_extraction_prompt_reset_done` toast.
- Split budget resolution (`lorebookBuildChunkBudget`): `budget = maxTokens` (the user's setting), then if the connection reports a `contextSize > 0`, `fit = (window - fixedTokens) ~/ 2` and `budget = min(budget, fit)`, floored at `kMinLorebookBuildChunkTokens`. `fixedTokens` is "system prompt plus context" that every request repeats — the reason the split exists at all is that the reply is about as long as the input.
- Chunking itself (`chunkLorebookText`) cuts **only between entry blocks** (blank lines) so an entry stays whole in one request, falling back to line breaks and then to raw length for an oversized block.
- No retries here; a failed part raises `LorebookBuildException.inPart(part, total, resumable:)` (labels like `catalog_lorebooks_err_part` / `catalog_lorebooks_err_part_resume`), which is where "part 14 of 20" wording comes from.

## Errors and user-visible messages

None in this file. The failure surfaces belong to the capture sheet and the rebuilder. Indirectly relevant: the settings here are the two levers a user has when a build fails with `LorebookBuildException` (`CatalogErrorSource.provider`) — switch the connection/model, or split the content smaller.

`LorebookBuildSplitGroup` shows a reset affordance only while `tokens != kDefaultLorebookBuildChunkTokens`; `LorebookBuildPromptsGroup` always shows one.

## Persistence

`shared_preferences`, through `AppSettings`, five keys: `lorebookBuildApiConfigId`, `lorebookBuildModel`, `lorebookBuildChunkTokens`, `lorebookBuildPrompt`, `lorebookBuildPromptJs`. `AppSettings.applyPartial` (the sync path) coerces types per key: `int` for chunk tokens with `parsed >= 0`, `String` for the rest.

## Porting notes for our SillyTavern port

1. **Port the settings, not the widget.** In Weaver's Vault the three groups become: (a) which Connection Profile / model the rebuild uses, (b) whether to split long captures and how big each request is, (c) the two system prompts. That is the complete behavioural surface of the closed-lorebook rebuild — nothing else in Glaze changes its output.
2. **The default-to-chat-connection rule is a good default for us too.** A user who never opens this sheet still gets working builds; only a user who wants a cheaper/stronger model for rebuilding changes it. SillyTavern already has the notion of a separate "utility"/"summarize" connection, which is the natural analogue.
3. **The split is not optional in practice.** The model echoes every entry body inside JSON, so the reply is at least as long as the input. Our port should implement chunking with the same constraints: cut between entry blocks, keep an entry whole, floor ~2000 tokens, cap at half the connection's context minus fixed prompt tokens, and make the per-part failure reporting explicit ("part N of M", resumable from the previous parts). Skipping this is the most likely reason a port "works on small lorebooks and fails on real ones".
4. **Store "empty means default" for the prompts.** Otherwise a stale pinned prompt silently survives every future improvement to the built-in wording — and `_seeded`/default-comparison logic in `LorebookBuildPromptsGroup` is the mechanism. Also copy the 600 ms debounce + flush-on-close; in JS the equivalent is `input` + `setTimeout` with a `save()` on `beforeunload`/sheet close.
5. **This sheet is where "the build failed" gets fixed**, so it must be reachable from the failure: Glaze puts a gear in the capture sheet's header and keeps the state (`partCache`) across retries. Our extension should open the same panel from the error state rather than sending the user to settings.
6. **Note the inconsistency to avoid**: the content-providers screen shows only the LLM and prompt groups inline (`third_party_providers_screen.dart`), while this sheet shows all three. One surface must be canonical — for us, this one (the one next to the flow).

## Open questions

- Whether `SheetView.startExpanded` interacts with `isScrollControlled` in a way that makes the sheet full-screen on phones (the property is from `shared/widgets/sheet_view.dart` and is not described here).
- Whether a build in progress re-reads these settings or snapshots them at start — `rebuildLorebookWithActiveLlm` reads `settings` once at entry (`:488`), so mid-build changes presumably do not apply to the running build (inferred). `services/janitor_lorebook_rebuilder.dart` would settle it.
- Whether `ApiSlotGroup` permits "no connection" as a selectable state or always binds one — not determined from this file; `features/settings/widgets/api_slot_group.dart`.
- Whether the "Preview prompt" affordance named in `catalog_extraction_settings_prompts_hint` is actually present on this sheet — it is not among the three groups' rows in `lorebook_build_settings.dart` (only fields + reset), so the hint may refer to a button elsewhere (`services/janitor_lorebook_rebuilder.dart` / capture sheet). That is a documentation/UI mismatch worth confirming before porting the string.
