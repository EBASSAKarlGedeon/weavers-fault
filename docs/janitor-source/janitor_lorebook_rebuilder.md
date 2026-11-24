# janitor_lorebook_rebuilder.dart

- **Path:** `C:/Users/Gedeon/Documents/Coding/Glaze-stable/lib/features/catalog/services/janitor_lorebook_rebuilder.dart`
- **Lines:** 658 (read 1–340 and 341–658; last line closes `_buildPart`)
- **Role:** Turns raw captured lorebook text — or a public "advanced" lorebook's JavaScript source — into keyed World Info entries by calling the user's active LLM, with prompt building, token-budget chunking, per-part caching and part-numbered failure reporting.

## Purpose

Dart port of the SillyTavern `janitor-lorebook` extension's `buildWithActiveLLM` (+ `buildExtractionMessages`, `stripFences`, `coerceEntries`). It owns **the token budget maths** for the rebuild side: the chunking/`fixedTokens`/half-the-window rule and the "never cap `max_tokens`" decision cannot be re-derived from a live request.

Inputs: concatenated entry bodies captured from an assembled JanitorAI prompt (`janitor_separate.dart` → `lorebookText`), or `jsSource` from a scripted book (`janitor_public_lorebook.dart`). Outputs: a `Lorebook` whose entries were split and keyed by the model.

## Behaviour walkthrough

**The two system prompts**

`kLorebookSystemPrompt` (plain-text split path) and `kLorebookSystemPromptJs` (JS-source path) are `const String`s with `'''…'''` quoting. Verbatim, `kLorebookSystemPrompt`:

```
You reconstruct a SillyTavern World Info (lorebook) from raw text.

You are given text extracted from an LLM chat prompt: one or more lorebook entries a
roleplay platform injected because their trigger keywords matched. The character card and
user persona have already been removed; what remains is lorebook entry bodies concatenated
together (often separated by blank lines). You may also be given the character card and a
catalog/world description as CONTEXT — use those ONLY to infer better keys, never output
them as entries.

Your job:
1. Split the text into discrete, self-contained World Info entries. Each coherent block
   about one topic (a person, place, faction, item, rule, lore fact) is one entry. Do NOT
   merge unrelated topics; do NOT split a single topic across entries.
2. For each entry write:
   - "content": the entry body, faithful to the source.
   - "key": array of primary trigger keywords/phrases (names, aliases, places, distinctive
     nouns), inferred from the content and the provided context.
   - "keysecondary": optional array of secondary keywords (else []).
   - "comment": a short title (the topic name).
   - "order": optional integer insertion order; default 100.
3. Output ONLY a JSON object:
   { "entries": [ { "comment": "...", "key": ["..."], "keysecondary": [], "content": "...", "order": 100 }, ... ] }
No markdown, no prose, no code fences — JSON only.
```

`kLorebookSystemPromptJs` opens:

```
You reconstruct a SillyTavern World Info (lorebook) from JavaScript source.

You are given the JavaScript source of a JanitorAI "advanced" / Nine API lorebook script. It
typically defines an array of lore entries (often `const loreEntries = [ ... ]`), where each
entry is an object with fields such as `keywords`/`keys`/`keysRaw`, `content`, `personality`,
`scenario`, `name`/`title`/`category`, `constant`, `priority`/`insertion_order`, and an
optional `filters.notWith` (secondary "not with" keywords). Some scripts assemble entries
with code; recover the resulting lore regardless.
```

…then the same CONTEXT paragraph, and a three-item task list whose item 1 is `Recover every distinct lore entry the script defines. Do NOT invent entries the script does not contain; do NOT merge unrelated entries or split a single entry.` Item 2's per-field guidance differs from the plain prompt and matters: content may be combined from `personality` and/or `scenario`; keys come from `keywords`/`keys`/`keysRaw`; `keysecondary` from `filters.notWith`; `comment` from `name`/`title`/`category`; `order` from `priority`/`insertion_order`. Item 3 is the identical JSON-only instruction.

**Exceptions**

- `NoActiveConnectionException` — `toString()` returns `'catalog_lorebooks_no_connection'.tr()`.
- `LorebookBuildException` — carries `message`, `source` (default `CatalogErrorSource.provider`), `rawText` (default `''`), `reasoning`, `rawResponseJson`, `cause`. `LorebookBuildException.fromProvider(error, …)` renders the transport failure with `formatError(error)` so it reads like `HTTP 401: Invalid API key`. `inPart(part, total, {resumable})` re-wraps with the i18n keys `catalog_lorebooks_err_part_resume` (when `resumable`) or `catalog_lorebooks_err_part`, passing `['<part>', '<total>', message]`.

**Chunk budget (`lorebookBuildChunkBudget`)**

```
const int kMinLorebookBuildChunkTokens = 2000;
// default maxTokens comes from kDefaultLorebookBuildChunkTokens = 24000
var budget = maxTokens;
final window = config?.contextSize ?? 0;
if (window > 0) { final fit = (window - fixedTokens) ~/ 2; if (fit < budget) budget = fit; }
return budget < kMinLorebookBuildChunkTokens ? kMinLorebookBuildChunkTokens : budget;
```

Rationale in the source: prompt and reply share the window and "the reply is about as long as the text". `fixedTokens` is what every request repeats (system prompt + all context blocks). The 2000 floor exists so a tiny/never-configured context size cannot shred the text into one-paragraph requests; 2000 is also the smallest request size the extraction settings offer. Note the floor is applied **after** the window clamp, so with `contextSize = 3000` and `fixedTokens = 2500` the budget is 2000 — i.e. the floor can exceed what the window allows.

`kDefaultLorebookBuildChunkTokens` is **not** declared in this file; it lives at `features/settings/app_settings_provider.dart:19` as `const kDefaultLorebookBuildChunkTokens = 24000;` with the note that the model copies every entry body back out inside its JSON, so a reply is at least as long as the input.

**Chunking (`chunkLorebookText`, `_splitOversized`)**

Greedy block packing:

- Blocks come from `splitEntries(text)` (`janitor_separate.dart`: split on `RegExp(r'\n\s*\n')`, trim, drop empties) — cuts happen **only between entry blocks**, so an entry stays whole in one request.
- Each block is first passed through `_splitOversized(block, maxTokens, '\n')`: if it fits, returned as-is; otherwise repacked line-by-line with the same greedy rule; any single line that still exceeds the budget recurses with `separator == ''`, which falls back to raw character slicing with `step = math.max(1, text.length * maxTokens ~/ tokens)` and `substring(i, min(i+step, length))`.
- Packing itself: accumulate `estimateTokens(piece, useCache: false)`; when `currentTokens > 0 && currentTokens + tokens > maxTokens`, flush `current.join('\n\n')` and start a new chunk. Trailing partial chunk is flushed at the end. Token counts come from Glaze's active BPE tokenizer via `estimateTokens` (~4 chars/token while no vocabulary is loaded).

Consequence to note: chunk sizes are measured with the *active* tokenizer, not necessarily the build model's.

**Request planning (`planLorebookBuild`)**

1. `messagesFor(text)` = `buildLorebookMessages(text, …)`.
2. If `fromJs || chunkTokens <= 0` → **one** request with the whole text (JS source must be read whole; `chunkTokens == 0` is the settings switch that disables chunking).
3. Otherwise `fixed = messagesFor('').fold(0, (sum, m) => sum + estimateTokens(m['content'] ?? ''))` — i.e. the system prompt plus the context-only user message (with the empty lorebook body, whose intro line still counts).
4. `budget = lorebookBuildChunkBudget(config, fixedTokens: fixed, maxTokens: chunkTokens)`; `chunks = chunkLorebookText(text, budget)`; if `chunks.length <= 1` → single request with the original text (avoids re-joining artefacts); else one message list per chunk, each carrying the **full** context.

**Prompt assembly (`buildLorebookMessages`)**

Returns exactly two messages: `{'role': 'system', 'content': system}` then `{'role': 'user', 'content': userParts.join('\n\n---\n\n')}`. Each context block is added only when non-empty after trim, as `'<intro>\n\n<value>'`, in this fixed order — these intros are literals to copy:

1. card — `CONTEXT — the character card these entries accompany. Use it ONLY to infer better trigger keys and resolve names/aliases. Do NOT output any of this card text as entries:`
2. catalog — `CONTEXT — the public catalog description for this character as shown on the site (setting, place and faction names). Use it ONLY to infer better trigger keys. Do NOT output any of this as entries:`
3. scenario — `CONTEXT — the scenario / setup for this roleplay. Use it ONLY to infer better trigger keys (names, places, situations). Do NOT output any of this as entries:`
4. greetings — `CONTEXT — the character's opening message(s) / greeting(s). Use them ONLY to infer better trigger keys (names, places, items mentioned). Do NOT output any of this as entries:`
5. lorebookDescs — `CONTEXT — the public descriptions of lorebooks attached to this character (titles and descriptions only — the lorebook contents themselves are NOT included here). Use them ONLY to infer better trigger keys. Do NOT output any of this as entries:`
6. extra — `CONTEXT — additional notes provided by the user (names, aliases, setting details). Use it ONLY to infer better trigger keys. Do NOT output any of this as entries:`

Then the body, always last: `'JavaScript lorebook source to convert into entries:\n\n$lorebookText'` when `fromJs`, else `'Raw lorebook text to convert into entries:\n\n$lorebookText'`. The system prompt is `systemPrompt ?? (fromJs ? kLorebookSystemPromptJs : kLorebookSystemPrompt)`. Exposed separately so the UI can preview the exact prompt without spending a call.

**Settings resolution (`lorebookSystemPrompt`, `resolveLorebookBuildConfig`)**

- `lorebookSystemPrompt(settings, fromJs:)` → the user's override (`settings.lorebookBuildPromptJs` for JS, else `settings.lorebookBuildPrompt`), trimmed; blank means "use the default". So the two settings keys are `lorebookBuildPrompt` and `lorebookBuildPromptJs`.
- `resolveLorebookBuildConfig(settings, configs:, active:)` → connection id from `settings.lorebookBuildApiConfigId` (empty = use the chat connection); falls back to `active` when the id is empty **or no longer exists**; returns null for `config.mode == 'embedding'`; then overlays the model: `settings.lorebookBuildModel.trim()` when non-empty → `config.copyWith(model: model)`.

**Orchestration (`rebuildLorebookWithActiveLlm`)**

Signature: `(Ref ref, {required String lorebookText, required String name, card, catalog, scenario, greetings, lorebookDescs, extra, fromJs = false, characterId, onProgress, partCache})`.

1. Reads `apiListProvider` + `appSettingsProvider` (Riverpod), calls `resolveLorebookBuildConfig`. If `config == null || config.endpoint.isEmpty || config.model.isEmpty` → throw `NoActiveConnectionException()`.
2. `planLorebookBuild(... chunkTokens: settings.lorebookBuildChunkTokens, systemPrompt: lorebookSystemPrompt(settings, fromJs: fromJs))`. Logs `[janitor-rebuilder] text split into <n> parts` when n > 1.
3. For each part `i`: `onProgress?.call(i, requests.length)` **before** the request; compute the cache key

```
[config.id, config.model, for (final m in messages) m['content'] ?? ''].join('\u0000')
```

(so the model is part of the key: "a part a different model built is not what a retry on this one would return"); reuse `partCache[key]` when present; otherwise `_buildPart`, and on `LorebookBuildException` rethrow when `requests.length == 1`, else wrap with `e.inPart(i + 1, requests.length, resumable: partCache != null)`; store the result in the cache.
4. `onProgress?.call(requests.length, requests.length)` after the loop, then `partCache?.clear()` — a *successful* build empties the cache so building again asks the model afresh; a failed build leaves earlier parts cached so it resumes at the failing part.
5. Logs `[janitor-extractor] rebuilt <n> lorebook entries`.
6. Returns a `Lorebook`: `id: generateId()`, `name`, `enabled: false`, `activationScope: characterId != null ? 'character' : 'global'`, `activationTargetId: characterId`, entries re-numbered `'jle_${stamp}_$i'` where `stamp = DateTime.now().millisecondsSinceEpoch` (unique across a split build), `updatedAt: currentTimestampSeconds()`.

Entry ids inside a part are placeholders `'jle_$index'` (index within the part), deliberately renumbered at the end.

**One request (`_buildPart`)**

Transport is `const AuxLlmClient().callOnce(config: AuxApiConfig(endpoint, apiKey, model, protocol, useResponsesApi, omitTemperature, extraRequestParameters), messages:, maxTokens: 0, temperature: 0.2, timeoutMs: 0, onRawResponse:)`. The comments state three deliberate decisions:

- `maxTokens: 0` → the transport **omits** `max_tokens` (`like JAR`): on reasoning models `max_tokens` bounds reasoning + content together, so any finite cap can be spent entirely on the thinking stream, leaving `content` empty with `finish_reason "length"`.
- `temperature: 0.2`.
- `timeoutMs: 0` → no idle guard and no HTTP receive timeout; a non-streaming request rebuilding a whole lorebook from a large prompt can legitimately exceed the default two minutes.

`onRawResponse(reasoning, rawResponseJson)` captures the reasoning stream and the raw provider JSON for diagnostics. Any transport throw → `LorebookBuildException.fromProvider(e, reasoning:…, rawResponseJson:…)`.

Then: debug logs `[janitor-rebuilder] model=… protocol=… endpoint=…`, `[janitor-rebuilder] response text (<n> chars): <first 1000>`, `[janitor-rebuilder] reasoning (<n> chars): <first 500>`, `[janitor-rebuilder] rawResponseJson (<n> chars): <first 2000>` (a `clip` helper appends `…`).

Parse pipeline: empty trimmed `raw` → `catalog_lorebooks_err_empty`; `jsonDecode(_stripFences(raw))` failure → `catalog_lorebooks_err_json` with the first 300 chars as the arg; `_coerceEntries(parsed)` then `_buildEntry` per item, skipping non-Maps and empty content; zero entries → `catalog_lorebooks_err_no_entries`.

`_stripFences(text)`: trim; if `RegExp(r'^```(?:json)?\s*([\s\S]*?)\s*```$', caseSensitive: false)` matches, take group 1 and trim; then find the first `[`/`{` and the **max** of the last `}` and last `]`, and slice between them when `last > first`.

`_coerceEntries(parsed)`: List → itself; Map with `entries` List → that; `entries` Map → `.values.toList()`; `lorebook` List → that; else `[]`.

`_buildEntry(raw, index)`: keys `key` ?? `keys` ?? `keywords`; secondary `keysecondary` ?? `secondary_keys` ?? `keySecondary`; content `content` ?? `text` (trimmed); comment `comment` ?? `title` ?? `name` ?? `category` ?? `'Entry <index>'`; order first num of `order`, then `priority`, then `insertion_order`, else `100`; `constant: raw['constant'] == true`; `position: 'matchGlobal'` (a fixed Glaze token — every rebuilt entry is match-triggered); `id: 'jle_<index>'`.

## Data shapes

Model reply expected: `{ "entries": [ { "comment": String, "key": [String], "keysecondary": [String], "content": String, "order": int } ] }` (also accepted: a bare array; `{lorebook: […]}`; `entries` as an object map). Emitted `LorebookEntry` fields set here: `id`, `comment`, `keys`, `secondaryKeys`, `content`, `order`, `constant`, `position`. Everything else (`probability`, `selectiveLogic`, `depth`, recursion flags …) keeps the model's defaults.

## Network / WebView contract

No WebView and no direct HTTP in this file: the only network call is `AuxLlmClient().callOnce`, Glaze's shared non-streaming transport (protocol chosen from the connection, prompt post-processing, extra request parameters, retry policy). It sends the two messages above to the configured provider; request body/headers are the transport's business. The i18n keys and error rendering come from `catalog_error_source.dart` / `error_format.dart`.

For a port, the relevant contract is: `POST <connection endpoint>` with `model`, `messages: [system, user]`, `temperature: 0.2`, **no** `max_tokens`, streaming off, and a client with **no** timeout (or a very long one).

## Selectors, regexes and string literals

- `RegExp(r'^```(?:json)?\s*([\s\S]*?)\s*```$', caseSensitive: false)` — fence stripping.
- `RegExp(r'[\[{]')`, `'}'`, `']'` — outermost JSON bounds.
- `'\u0000'` — part-cache key separator.
- `'\n\n---\n\n'` — user-part joiner.
- i18n keys: `catalog_lorebooks_no_connection`, `catalog_lorebooks_err_empty`, `catalog_lorebooks_err_json`, `catalog_lorebooks_err_no_entries`, `catalog_lorebooks_err_part`, `catalog_lorebooks_err_part_resume`.
- Settings keys: `lorebookBuildPrompt`, `lorebookBuildPromptJs`, `lorebookBuildApiConfigId`, `lorebookBuildModel`, `lorebookBuildChunkTokens`.
- Entry id prefixes: `'jle_'` (rebuilt), `'jpl_'` (`janitor_public_lorebook.dart`), `'jle_<stamp>_'` final.
- Magic numbers: `2000` (min chunk), `24000` (default chunk), `100` (default order), `0.2` (temperature), `300` / `1000` / `500` / `2000` (log/preview clips).
- `'matchGlobal'` — position assigned to every rebuilt entry.

Exact user-visible English for the keys (from `assets/translations/en.json`):

- `catalog_lorebooks_no_connection` = `No active LLM connection. Add one in Settings → API and select it before building a lorebook.`
- `catalog_lorebooks_err_empty` = `The model returned an empty response. It may have spent its whole token budget on reasoning, the answer may have been filtered, or the response carried no content field. Open the details below for the raw provider payload.`
- `catalog_lorebooks_err_json` = `The model did not return valid JSON. First 300 characters:` + newline + `{}`
- `catalog_lorebooks_err_no_entries` = `The model returned no usable lorebook entries.`
- `catalog_lorebooks_err_part` = `Part {} of {}: {}`
- `catalog_lorebooks_err_part_resume` = `Part {} of {}: {} Building again resumes from this part.`

## State machine, retries, timings

- **Parts are sequential**, one `callOnce` each, `onProgress` before each and once at the end as `(total, total)`.
- **Retry model:** no retries inside a part; recovery is *resume by cache*. `partCache` is keyed by (connection id, model, each message content) and cleared only on full success, so a 14-of-20 failure re-sends only parts 14–20 next time. The cache is caller-owned and in-memory only.
- **Timings:** `timeoutMs: 0` (no timeout) on the request; no polling; no backoff. UI-side elapsed counters exist in the sheet (`catalog_lorebooks_building` = `Building… {}s`, `catalog_lorebooks_building_parts` = `Building… part {} of {} · {}s`) but are not in this file.
- **Chunk count** is a pure function of text length, `contextSize`, `lorebookBuildChunkTokens` and the sum of the context-block token counts.

## Errors and user-visible messages

`NoActiveConnectionException` renders the "add a connection" sentence listed above. Every other failure is a `LorebookBuildException` carrying the raw text / reasoning / raw provider JSON so the UI can show `catalog_lorebooks_llm_debug` = `LLM response (debug)`; the caller wraps it as `catalog_lorebooks_build_failed` = `Build failed: {}`. Part failures get the `Part {} of {}: {}` prefix plus the resume sentence when a cache exists, and the error block is headed `PROVIDER ERROR` via `CatalogErrorSource.provider`.

## Persistence

None. `partCache` is memory-only and cleared on success; the returned `Lorebook` is persisted by the caller. Settings live in shared prefs under the keys listed above.

## Porting notes for our SillyTavern port

- **Reproduce literally:** the two system prompts (including the JSON-only, no-fences instruction and the `order` default of 100); the six CONTEXT intros and their order; the `'\n\n---\n\n'` joiner; the body-last rule; `temperature 0.2`; **no `max_tokens`**; **no request timeout**; the `formatError`-style error rendering; the part/resume UX.
- **Reproduce the budget maths exactly:** `min(chunkTokens, (contextSize - fixedTokens) / 2)` with a 2000 floor, `fixedTokens` measured from the *assembled* empty-body request (system + context only), block-greedy packing with `\n\n` joins, and line→char fallback for oversized pieces. Getting `fixedTokens` wrong (e.g. counting only the system prompt) over-fills the prompt and truncated JSON is the failure mode.
- **In ST the tokenizer differs:** `estimateTokens` here uses Glaze's active BPE vocabulary, and `JanitorLoreBudget` separately counts `cl100k`. In our extension, use ST's own token counter (`getTokenCount`/`text_tokenizer`) and accept ±few %; keep the safety margins (half the window, 2000 floor) as-is.
- **Dart-only scaffolding:** Riverpod `Ref`, `ApiConfig`/`AuxApiConfig`/`AuxLlmClient`, `Lorebook`/`LorebookEntry`, `generateId()`, `currentTimestampSeconds()`, `easy_localization`'s `.tr()`, `debugPrint`. In JS these become plain objects, `crypto.randomUUID()`, `Date.now()` and a small i18n lookup. Settings keys to mirror: `lorebookBuildChunkTokens` (24000; 0 = never split), `lorebookBuildPrompt`/`lorebookBuildPromptJs` (blank = default), `lorebookBuildApiConfigId` + `lorebookBuildModel` (blank = the chat connection/model; embedding-mode connections rejected).
- **Fragile / decisions to keep or revisit:** `_stripFences`'s "last `}` vs last `]`" can swallow trailing prose into the slice and produce invalid JSON (it then reports `catalog_lorebooks_err_json` — acceptable, but a stricter extractor would help); `position: 'matchGlobal'` means every rebuilt entry is keyword-matched with no constant entries; the 2000 floor can exceed the window clamp for small context sizes; the resume cache key hashes the entire message content, so any settings/context change invalidates all cached parts (correct, but a user editing the prompt mid-failure loses the cache silently).

## Open questions

- Whether the transport's retry policy (`AuxLlmClient`) retries a 5xx before surfacing the error — UNKNOWN — not determined from this file; `core/llm/aux_llm_client.dart` would settle it (matters for how many provider calls a failing part actually costs).
- Whether `estimateTokens` in the UI isolate has a real BPE vocabulary loaded at build time, or falls back to ~4 chars/token — UNKNOWN — not determined from this file; `features/settings/api_list_provider.dart` (does it call `activateTokenizer`?) would settle it.
- What `contextSize` holds for connections that never specify one (`0` ⇒ no window clamp, so only `lorebookBuildChunkTokens` applies) — the field's default is not visible here; `core/models/api_config.dart` would settle it.
