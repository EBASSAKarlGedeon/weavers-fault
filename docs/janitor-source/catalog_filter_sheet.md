# catalog_filter_sheet.dart

- **Path:** C:/Users/Gedeon/Documents/Coding/Glaze-stable/lib/features/catalog/widgets/catalog_filter_sheet.dart
- **Lines:** 544 (read in full: 1-544)
- **Role:** The single catalog filter bottom sheet for all four sources — it decides, per provider, which filter vocabulary is *shown* (NSFW/NSFL, token range, Chub's eleven search flags, tag picker, JanitorAI's account block list) and commits the result by diffing a rebuilt `CatalogFilters` on `dispose()`.

## Purpose

One sheet serves JanitorAI, Janny, DataCat and Chub, plus Chub's Timeline feed and JanitorAI's signed-in account block list. The sheet itself is *stateless about filters*: `FilterSheet` is presentational, the owner (`_CatalogFilterSheetState`) holds local mutable copies of every field, and the committed value is produced once in `dispose()` from a freshly constructed `CatalogFilters` compared against the incoming one with freezed deep equality. There is no Apply button.

Three separate jobs live in this file:

1. **Vocabulary selection per provider** — Content group (NSFW / NSFL / NSFW-only), Card group (token range, Chub's min-AI-rating and min-tag count), Chub's "Must include" + "Other" groups, and the tag picker (curated ids vs free-text names).
2. **Chub NSFL gating** — a two-step gate: login-required sheet, then a destructive-content warning dialog.
3. **JanitorAI account block list** — read `GET /hampter/profiles/mine/blocked-content` on open, PATCH the whole `block_list` back on close if the tag-id set or the keyword set changed, then ask the catalog to reload.

## Behaviour walkthrough

### Constructor contract

```dart
const CatalogFilterSheet({
  super.key,
  required this.filters,        // CatalogFilters
  required this.provider,       // CatalogProvider
  required this.onApply,        // ValueChanged<CatalogFilters>
  this.timelineMode = false,
  this.onBlockedTagsChanged,    // VoidCallback? — reload catalog after PATCH
});
```

`timelineMode` doc: "Chub's "Timeline" feed is served by its own endpoint that only consumes `nsfw` and `nsfl`; every other catalog filter is ignored. When set, the sheet hides those controls and shows a hint instead". `onBlockedTagsChanged` is "Called after the JanitorAI account block list is PATCHed (blocked tags or keywords changed), so the catalog list can be reloaded to reflect it."

### State

Twelve scalar mirrors of `CatalogFilters` (`_nsfw`, `_nsfl`, `_minTokens`, `_maxTokens`, `_nsfwOnly`, `_requireImages`, `_requireLore`, `_requireCustomPrompt`, `_requireExampleDialogues`, `_requireAlternateGreetings`, `_recommendedVerified`, `_excludeMine`, `_inclusiveOr`, `_minAiRating`, `_minTags`), two selection sets `Set<int> _selectedTagIds` / `Set<String> _selectedTagNames`, `List<CatalogTag> _allTags`, `bool _tagsLoading = true`, and the block-list trio `JanitorBlockList? _blockList`, `Set<int> _blockedTagIds`, `Set<String> _blockedKeywords`. `_blockList` is `null` until the initial fetch lands **and** stays null when the fetch throws, which is what keeps the whole section hidden.

Two derived getters:

```dart
bool get _isJanitor => widget.provider == CatalogProvider.janitor;
bool get _janitorBlockTagsEnabled => _isJanitor && ref.read(janitorAccountProvider).isLoggedIn;
bool get _isChub => widget.provider == CatalogProvider.chub;
```

### `initState`

Copies every field from `widget.filters`, then:

```dart
if (!widget.timelineMode) _loadTags();
if (_janitorBlockTagsEnabled) _loadBlockedTags();
```

Timeline mode therefore does **no** tag fetch at all.

### `_loadTags()`

```dart
if (chub)      tags = await fetchChubTags(apiKey: ref.read(chubAccountProvider).apiKey);
else if (datacat) tags = await fetchDatacatTags();
else           tags = await fetchJanitorTags();   // janitor AND janny
```

So **Janny is served JanitorAI's curated tag list** (`https://janitorai.com/hampter/tags`, numeric ids), matching Janny's metadata query `tagIds = <id>` (see `services/janny_provider.dart`). After `setState` sets `_allTags`/`_tagsLoading = false`, the JanitorAI-only second load runs:

```dart
if (!_isJanitor) return;
final popular = await fetchJanitorTopCustomTags();
if (!mounted || popular.isEmpty) return;
final merged = withPopularCustomTags(tags, popular);
if (merged.length == tags.length) return;
setState(() { _allTags = merged; });
```

`fetchJanitorTopCustomTags()` bootstraps from one listing call, `GET https://janitorai.com/hampter/characters?page=1&mode=sfw&sort=trending24`, reading `top_custom_tags`. `withPopularCustomTags` appends popular custom tags *after* the curated ones, deduped case-insensitively, producing `CatalogTag(name: name)` with **no id** — that is how a custom tag lands in `tagNames` instead of `tagIds`.

### `_loadBlockedTags()`

```dart
final list = await fetchJanitorBlockedContent();
setState(() { _blockList = list; _blockedTagIds = list.tags.toSet(); _blockedKeywords = list.keywords.toSet(); });
} catch (_) { /* Not signed in / CF block / network — leave the section hidden. */ }
```

Silent by design: a failure is indistinguishable from "not applicable", so a signed-in user whose read failed sees no block-list UI at all and gets no retry affordance (porting gap, see below).

### `dispose()` — the commit path

```dart
final newFilters = CatalogFilters(
  sort: widget.filters.sort,               // sort is NOT edited here
  nsfw: _nsfw, nsfl: _nsfl,
  tagIds: _selectedTagIds.toList()..sort(),
  tagNames: _selectedTagNames.toList()..sort(),
  excludeTagNames: widget.filters.excludeTagNames,  // passed through, no control
  minTokens: _minTokens, maxTokens: _maxTokens,
  nsfwOnly: _nsfwOnly, requireImages: _requireImages, requireLore: _requireLore,
  requireCustomPrompt: _requireCustomPrompt,
  requireExampleDialogues: _requireExampleDialogues,
  requireAlternateGreetings: _requireAlternateGreetings,
  recommendedVerified: _recommendedVerified, excludeMine: _excludeMine,
  inclusiveOr: _inclusiveOr, minAiRating: _minAiRating, minTags: _minTags,
);
if (newFilters != widget.filters) {
  final apply = widget.onApply;
  Future.microtask(() => apply(newFilters));
}
_saveBlockedTagsIfChanged();
super.dispose();
```

Comment in source: "Build the candidate up front and let freezed's deep equality decide whether anything actually changed — the sheet edits a lot of fields now, and hand-rolling the comparison is how a new one silently stops applying." Note what is missing from the rebuild: `window` (DataCat only, edited in `datacat_sort_sheet`) and `excludeTagNames` — both are dropped to the *incoming* values, so a default `CatalogFilters()` field added later must be threaded here or it will be reset on every close.

`_saveBlockedTagsIfChanged()` builds the updated list with `original.copyWith(tags: _blockedTagIds.toList()..sort(), keywords: _blockedKeywords.toList()..sort())` (bots and creators preserved verbatim from the fetched record because the API replaces the whole `block_list`), then:

```dart
Future.microtask(() async {
  await saveJanitorBlockList(updated);
  onChanged?.call();   // catalogProvider.search(reset: true)
});
```

Because the closure is not awaited and not guarded, a failed PATCH throws inside a microtask and `onChanged` never fires (inferred from the code; nothing catches it).

### Groups

`_contentGroup()` — title `catalog_filter_group_content` ("Content"):

- `catalog_filter_nsfw` ("Show NSFW") — every provider.
- if chub: `catalog_filter_nsfl` ("Show NSFL") with `isDanger: true` (`_dangerColor = Color(0xFFFF5A5F)`), and if `!timelineMode` also `catalog_filter_nsfw_only` ("NSFW only").

`_cardGroup()` — title `catalog_filter_group_card` ("Card"):

- `FilterRangeSection(title: catalog_token_range` "Token Range", `minLabel: catalog_min` "Min", `maxLabel: catalog_max` "Max", defaults from `const CatalogFilters()` = `29` / `100000`).
- if chub: `FilterNumberSection` `catalog_filter_min_ai_rating` ("Minimum AI rating") and `catalog_filter_min_tags` ("Minimum tag count"), each labelled `catalog_min`.

`_chubSections()`:

- `FilterGroupSection(title: catalog_filter_group_require` "Must include", `collapsible: true`) with five `FilterToggleSection`s: `catalog_filter_require_images` "With gallery images", `catalog_filter_require_lore` "With lorebooks", `catalog_filter_require_custom_prompt` "With custom prompt", `catalog_filter_require_example_dialogues` "With example dialogues", `catalog_filter_require_alternate_greetings` "With alternate greetings". Chub param names (context: `chub_provider.dart`): `require_images`, `require_lore`, `require_custom_prompt`, `require_example_dialogues`, `require_alternate_greetings` — all `=true`.
- `FilterGroupSection(title: catalog_filter_group_other` "Other") with `catalog_filter_recommended_verified` "Recommended / verified" (`recommended_verified=true`) and `catalog_filter_exclude_mine` "Exclude my characters" (`exclude_mine=true`).

### Tags section

```dart
FilterTagsSection(
  title: 'catalog_tags'.tr(),                  // "Tags"
  searchHint: 'catalog_search_tags'.tr(),      // "Search tags..."
  tags: [for (final t in _allTags) FilterTag(id: t.id, name: t.name)],
  loading: _tagsLoading,
  selectedIds: _selectedTagIds, selectedNames: _selectedTagNames,
  onToggle: _toggleTag, onClear: _clearTags,
  options: [ if (_isChub) FilterToggleSection(label: 'catalog_filter_inclusive_or'.tr(), …) ],
  fetchSuggestions: _tagSuggestions,
  allowCustomTags: _isJanitor || _isChub,
)
```

`_toggleTag` routes by `tag.id != null` into `_selectedTagIds`, else by `tag.name` into `_selectedTagNames`. `_tagSuggestions`:

```dart
if (_isJanitor) return fetchJanitorTagSuggestions;                 // GET /hampter/characters/tags/suggest?prefix=…
if (_isChub) { final apiKey = …; return (q) => fetchChubTagSuggestions(q, apiKey: apiKey); }
return null;                                                        // janny, datacat: no remote autocomplete
```

`allowCustomTags` is `true` for JanitorAI **and** Chub only — so a Janny or DataCat query that matches nothing can never be applied, consistent with those providers' searches, which consume ids (`tagIds = <id>` for janny) and not `tagNames`.

### Chub NSFL gate

`_onNsflToggle(bool value)`:

- `false` → `setState(() => _nsfl = false)`.
- `true` and `!ref.read(chubAccountProvider).isLoggedIn` → `_promptChubLoginForNsfl()`, and **the switch does not flip**.
- `true` and signed in → `_confirmNsfl()`.

`_promptChubLoginForNsfl()` — `GlazeBottomSheet.show`, title `catalog_filter_nsfl`, `BottomSheetBigInfo(icon: Icons.lock_outline_rounded, description: chub_nsfl_login_desc)`, one centred item `chub_nsfl_login_btn`. Its `onTap` pops the sheet, awaits `showChubLoginSheet(context)`, then "Signed in via the WebView — carry the toggle through to the warning instead of making them tap NSFL again": `if (ref.read(chubAccountProvider).isLoggedIn) _confirmNsfl();`.

`_confirmNsfl()` — title `catalog_nsfl_warning_title`, `BottomSheetBigInfo(icon: Icons.warning_amber_rounded, description: catalog_nsfl_warning_desc)`, items: `catalog_nsfl_btn` with `isDestructive: true, centered: true` (sets `_nsfl = true`, pops) and `catalog_nsfl_btn_cancel`. Both `Navigator.of(context, rootNavigator: true).pop()`.

### `build`

`FilterSheet(title: 'catalog_filters'.tr(), sections: [...])`:

1. `_contentGroup()` — always.
2. `if (widget.timelineMode)` a single `FilterCustomSection(child: _TimelineFiltersHint())`; **else** the rest:
   - `if (CatalogControls.supportsTokenRange(widget.provider)) _cardGroup()` — `!= CatalogProvider.datacat`, because "DataCat's Client API filters by text, tags, sort and paging only — there are no token bounds to send".
   - `if (_isChub) ..._chubSections()`.
   - the tags section.
   - `if (_blockList != null) FilterCustomSection(padded: false, child: JanitorBlockedContentSection(...))` — `padded: false` because the child brings its own `MenuGroup` card.

`_TimelineFiltersHint` renders `Row` of `Icons.info_outline_rounded` (size 16, `onSurfaceVariant`), 10 px gap, `Text('catalog_chub_timeline_no_filters'.tr())` at fontSize 13, height 1.35.

## Data shapes

`CatalogFilters` (freezed, `catalog_models.dart`): `sort` `'trending'`, `nsfw`, `nsfl`, `List<int> tagIds`, `List<String> tagNames`, `List<String> excludeTagNames`, `int minTokens = 29`, `int maxTokens = 100000`, `nsfwOnly`, `requireImages`, `requireLore`, `requireCustomPrompt`, `requireExampleDialogues`, `requireAlternateGreetings`, `recommendedVerified`, `excludeMine`, `inclusiveOr`, `int minAiRating = 0`, `int minTags = 0`, `String window = 'all'`.

`CatalogTag`: `{int? id, required String name, String? slug}` — id null ⇒ name-based (free text).

`JanitorBlockList`: `{List<dynamic> bots, List<dynamic> creators, List<String> keywords, List<int> tags}` with `copyWith({tags, keywords})` only.

## Network / WebView contract

All JanitorAI traffic goes through `JanitorWebViewProxy.instance.fetch` (headless WebView, cookie jar shared with the login sheet):

- `GET https://janitorai.com/hampter/tags` → JSON array of `{id, name, slug}` (falls back to a hard-coded 61-entry `_fallbackTagMap`, ids 1-61 with gaps at 33/35/37/40/58).
- `GET https://janitorai.com/hampter/characters?page=1&mode=sfw&sort=trending24` → `top_custom_tags` (array of strings or objects read as `name`/`tag`/`slug`).
- `GET https://janitorai.com/hampter/characters/tags/suggest?prefix=<encoded>` → `{"suggestions": [...]}`.
- `GET https://janitorai.com/hampter/profiles/mine/blocked-content` → `{bots, creators, keywords, tags}`.
- `PATCH https://janitorai.com/hampter/profiles/mine` body `{"block_list":{"bots":[…],"creators":[…],"keywords":[…],"tags":[…]}}`.

Chub: tag index `POST <apiBase>/tags` with `{search, limit, sort:'n_projects', nsfw:true, nsfl:true}`; per-search flags go to `<apiBase>/search` (`nsfw_only`, `require_images`, `require_lore`, `require_custom_prompt`, `require_example_dialogues`, `require_alternate_greetings`, `recommended_verified`, `exclude_mine`, `inclusive_or`, `min_ai_rating`, `min_tags`, `topics`, `excludetopics`, `min_tokens`, `max_tokens`).

**The important asymmetry:** `janitorSearch` builds only `page`, `mode` (`all`/`sfw` from `nsfw`), `sort`, `search`, `tag_id[]`, `custom_tags[]`. It sends **no token bounds and no NSFL**, so on JanitorAI the "Card → Token Range" row (defaults 29-100000) is a control that changes the persisted filter and the active-filter badge but does not reach the request. Janny sends `totalToken >= / <=` and `tagIds = <id>` into a Meilisearch filter string; DataCat is exempted from the row entirely.

## Selectors, regexes and string literals

i18n keys → English (from `assets/translations/en.json`):

| key | English |
| --- | --- |
| `catalog_filters` | `Filters` |
| `catalog_filter_group_content` | `Content` |
| `catalog_filter_group_card` | `Card` |
| `catalog_filter_group_require` | `Must include` |
| `catalog_filter_group_other` | `Other` |
| `catalog_filter_nsfw` | `Show NSFW` |
| `catalog_filter_nsfl` | `Show NSFL` |
| `catalog_filter_nsfw_only` | `NSFW only` |
| `catalog_token_range` | `Token Range` |
| `catalog_min` / `catalog_max` | `Min` / `Max` |
| `catalog_filter_min_ai_rating` | `Minimum AI rating` |
| `catalog_filter_min_tags` | `Minimum tag count` |
| `catalog_filter_require_images` | `With gallery images` |
| `catalog_filter_require_lore` | `With lorebooks` |
| `catalog_filter_require_custom_prompt` | `With custom prompt` |
| `catalog_filter_require_example_dialogues` | `With example dialogues` |
| `catalog_filter_require_alternate_greetings` | `With alternate greetings` |
| `catalog_filter_recommended_verified` | `Recommended / verified` |
| `catalog_filter_exclude_mine` | `Exclude my characters` |
| `catalog_filter_inclusive_or` | `Match any tag` |
| `catalog_tags` / `catalog_search_tags` | `Tags` / `Search tags...` |
| `catalog_chub_timeline_no_filters` | `Chub Timeline doesn't support filters` |
| `catalog_nsfl_warning_title` | `NSFL Content Warning` |
| `catalog_nsfl_warning_desc` | `Trust me, you don't want to do this.` |
| `catalog_nsfl_btn` | `I have nothing to lose` |
| `catalog_nsfl_btn_cancel` | `I'm too young to die` |
| `chub_nsfl_login_desc` | `To show NSFL characters you have to sign in to a Chub account. This is a site limitation. Sign in?` |
| `chub_nsfl_login_btn` | `Sign in` |
| `catalog_clear_tags` | `Clear ({count})` (rendered by `FilterClearButton`) |
| `catalog_add_custom_tag` | `Search by tag "{tag}"` (rendered by `FilterTagPicker` when `allowCustomTags`) |

No regexes in this file. Numeric literals: `29`, `100000`, `0xFFFF5A5F`, `16/10/13/1.35` layout constants.

## State machine, retries, timings

- State machine is *the sheet's local mirrors*; nothing is committed until `dispose()`. Closing by back-navigation, drag, or scrolling away all commit.
- Two `Future.microtask`s are scheduled from `dispose()`: apply-filters first (registered first), then the block-list PATCH. Ordering is incidental to Dart's microtask queue, not enforced.
- No retries. `_loadTags` caches upstream (`fetchJanitorTags` caches `_tagsFetched`, `fetchChubTags` caches `_chubTagsFetched`, both `else` fall through to the hard-coded tag map on catch). Debounce (250 ms) lives in the child widgets, not here.
- Tag fetch failure ⇒ empty grid + `_tagsLoading: false`; no error text in this file.

## Errors and user-visible messages

Nothing renders an error. Failure modes are silent or delegated: `_loadBlockedTags` swallows, PATCH failure is unhandled, `_loadTags` providers swallow. The only interactive interruptions are the two Chub NSFL sheets.

## Persistence

This file persists nothing itself, but it defines what is persisted: `catalogProvider` JSON-encodes every field into prefs per provider (`_filtersKeyFor(provider)`), including `nsfl`, `tagIds`, `tagNames`, `minTokens`, `maxTokens`, all eleven Chub flags, and `window`. The block list lives on the JanitorAI **account** (server side), not in app prefs — editing it changes the user's real janitorai.com settings, and the catalog reload afterwards is what makes the change visible in results.

## Porting notes for our SillyTavern port

1. **Model the sheet as a projected view of a single filter object**, commit-on-close, diff with a value-equality compare. That is the whole reason this file survived four providers; a per-control "apply" callback set drifts.
2. **Filter vocabulary is per provider and must be capability-flagged, not merely hidden.** The file's own scars: NSFL is Chub-only *and* account-gated; the token range is hidden for DataCat because its API takes no bounds; the Chub groups are collapsible because five rarely-used switches otherwise dominate the sheet. For our port the JanitorAI-capable set is: `mode=sfw|all`, `sort`, `search`, `tag_id[]`, `custom_tags[]` — everything else is decoration and should either be wired or omitted.
3. **Do not ship a token-range control for JanitorAI without wiring it.** Upstream shows it and JanitorAI ignores it; in a JS port we can filter client-side on the `totalToken` field returned by the listing (field names: `totalToken` / `total_tokens`), or drop the row.
4. **Two kinds of tag must stay separate**: numeric curated ids (`tag_id[]`) and free-text names (`custom_tags[]`). Any UI that collapses them into one chip list still has to route the value correctly (`FilterTag.id == null` ⇒ name).
5. **The block list is a full-replacement PATCH**: read `bots`/`creators` first, preserve them, replace only `tags`/`keywords`, sort both lists before sending, and reload the catalog afterwards (JanitorAI applies the block server-side, so results change).
6. **Gate destructive toggles behind an explicit confirmation** and, when a precondition (login) is missing, send the user to get it and then continue the flow automatically — the `_promptChubLoginForNsfl` → `_confirmNsfl` chain is the pattern.
7. **Failures should be visible** in our port: a failed block-list read currently hides the section forever; make it a retry row.

## Open questions

- Whether JanitorAI's `blocked-content` PATCH accepts partial or malformed `bots`/`creators` verbatim — UNKNOWN — not determined from this file; `services/janitor_provider.dart` / `services/janitor_webview_proxy.dart` only show we round-trip them opaquely.
- Whether `fetchJanitorTags`'s cached list is ever invalidated on account switch — UNKNOWN — `fetchJanitorTags` has no reset counterpart (unlike `resetChubTagCache` in `chub_provider.dart`); would be settled by grepping for a tag-cache reset in `catalog_provider.dart`.
- Whether the block-list PATCH failure is surfaced anywhere else (a global error handler) — UNKNOWN — not determined from this file.
