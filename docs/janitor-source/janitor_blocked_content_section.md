# janitor_blocked_content_section.dart

- **Path:** C:/Users/Gedeon/Documents/Coding/Glaze-stable/lib/features/catalog/widgets/janitor_blocked_content_section.dart
- **Lines:** 215 (read in full: 1-215)
- **Role:** The JanitorAI account block-list editor embedded in the catalog filter sheet — one search field that resolves to either a curated tag (blocked by numeric id) or free text (blocked as a keyword), rendered as one undifferentiated chip list.

## Purpose

This is the only place where a user sees and edits JanitorAI's `block_list`. Its doc comment states the whole design thesis:

> "To the user everything here is just a "tag". Under the hood JanitorAI splits them into curated `allTags` (blocked by id → `tags`) and free-text `keywords` (custom tags blocked by name); "keyword" is only the API's name."

The widget is **fully controlled**: it owns no block data. `Set<int> blockedTagIds` and `Set<String> blockedKeywords` come in as parameters and every mutation goes out through a callback (`onToggleTag`, `onAddKeyword`, `onRemoveKeyword`, `onClear`). The owner (`CatalogFilterSheet`) holds the sets, PATCHes them on close, and reloads the catalog. This file owns exactly two pieces of local state that the server never sees: the text field's query and the suggestion list fetched for it.

## Behaviour walkthrough

### Constructor

```dart
final List<CatalogTag> allTags;         // curated tags, for by-id blocking + local name matching
final Set<int> blockedTagIds;
final Set<String> blockedKeywords;
final ValueChanged<int> onToggleTag;
final ValueChanged<String> onAddKeyword;
final ValueChanged<String> onRemoveKeyword;
final VoidCallback onClear;
```

It is a plain `StatefulWidget` (not `ConsumerStatefulWidget`) — no Riverpod access here, so the suggestion fetch is the free function `fetchJanitorTagSuggestions` from `services/janitor_provider.dart`.

### Local state

```dart
final _controller = TextEditingController();
Timer? _debounce;        // 250 ms
List<String> _suggestions = [];
bool _loading = false;
String _query = '';
```

`_query` is not just the trimmed text: it is the query the in-flight (or last) suggestion fetch was for. Comment: "guards against out-of-order responses overwriting newer results."

### `_tagName(int id)`

```dart
widget.allTags.firstWhere((t) => t.id == id, orElse: () => CatalogTag(id: id, name: '#$id')).name
```

So a blocked id whose curated tag has disappeared from the fetched list is still shown — as the literal `#<id>`. Resolution failures are visible, never dropped.

### `_selectedCount`

`blockedTagIds.length + blockedKeywords.length` — the count shown in the card's `Clear (n)` action.

### `_onChanged(String value)` — the debounce

```dart
final q = value.trim();
setState(() => _query = q);
_debounce?.cancel();
if (q.isEmpty) { setState(() { _suggestions = []; _loading = false; }); return; }
setState(() => _loading = true);
_debounce = Timer(const Duration(milliseconds: 250), () => _fetch(q));
```

Empty query short-circuits — **no network request for an empty prefix**, and the loading spinner is cleared immediately.

### `_fetch(String q)`

```dart
final results = await fetchJanitorTagSuggestions(q);   // never throws
if (!mounted || q != _query) return;
setState(() { _suggestions = results; _loading = false; });
```

The `q != _query` guard is the out-of-order defence. Note the failure path: the provider resolves to `const []` on any error (empty prefix, HTTP error, CF challenge, non-JSON), so a failed autocomplete is indistinguishable from "nothing matched" — there is no error copy here.

### `_addKeyword` / `_toggleTag` / `_reset`

```dart
void _addKeyword(String keyword) { final k = keyword.trim(); if (k.isEmpty) return; widget.onAddKeyword(k); _reset(); }
void _toggleTag(int id) { widget.onToggleTag(id); _reset(); }
void _reset() { _controller.clear(); setState(() { _query = ''; _suggestions = []; _loading = false; }); }
```

Both commit paths end the search: the chip disappears from the suggestion area and reappears in the selected chip block, so the reset is what makes the move legible.

Practical consequence: **blocking a series of keywords means retyping the prefix each time** (nothing keeps the query). Blocking an already-blocked tag from the chip block removes it (the chip calls `widget.onToggleTag`), which is the only unblock gesture.

### `_tagMatches` and `_keywordMatches`

```dart
List<CatalogTag> get _tagMatches {
  if (_query.isEmpty) return const [];
  final q = _query.toLowerCase();
  return widget.allTags
      .where((t) => t.id != null &&
                    !widget.blockedTagIds.contains(t.id) &&
                    t.name.toLowerCase().contains(q))
      .take(8).toList();
}

List<String> get _keywordMatches =>
    _suggestions.where((s) => !widget.blockedKeywords.contains(s)).take(8).toList();
```

Case-insensitive substring match, capped at 8 each, already-blocked entries filtered out. A custom tag has no id (`CatalogTag(name: …)` from `withPopularCustomTags`), so it can never match here — by design, the curated and free-text halves stay separable.

### `build`

```dart
MenuGroup(
  header: 'catalog_blocked_tags'.tr(),                  // "Blocked tags"
  headerVariant: MenuGroupHeaderVariant.accentCaps,
  headerTrailing: _selectedCount > 0
      ? FilterClearButton(count: _selectedCount, onTap: widget.onClear)
      : null,
  items: [ Padding(padding: const EdgeInsets.fromLTRB(16, 6, 16, 10), child: Column(...
```

The column, top to bottom:

1. If `_selectedCount > 0`: a `Wrap(spacing: 6, runSpacing: 6)` of selected chips — first every blocked id as `FilterTagChip(label: _tagName(id), selected: true, onTap: () => widget.onToggleTag(id))`, then every keyword as `FilterTagChip(label: k, selected: true, onTap: () => widget.onRemoveKeyword(k))`. Then `SizedBox(height: 12)`. The two lists are deliberately visually identical ("no visual distinction between the two backing lists").
2. `FilterSearchField(controller: _controller, hint: 'catalog_blocked_search'.tr(), loading: _loading, onChanged: _onChanged, onClear: _reset, onSubmitted: _addKeyword)` — submitting the raw text blocks it as a keyword.
3. If `_query.isNotEmpty`: `SizedBox(height: 12)` then a second `Wrap` containing, in order:
   - the raw-text chip, only when the query is not already blocked: `FilterTagChip(label: 'catalog_blocked_add_keyword'.tr(namedArgs: {'keyword': _query}), icon: Icons.block_rounded, onTap: () => _addKeyword(_query))`;
   - each `_tagMatches` entry as `FilterTagChip(label: t.name, onTap: () => _toggleTag(t.id!))`;
   - each `_keywordMatches` string as `FilterTagChip(label: k, onTap: () => _addKeyword(k))`.

There is no divider or heading between the three result kinds, and the icon (`Icons.block_rounded`) on the raw chip is the only cue distinguishing "block this exact text" from "block a curated tag".

Ordering nuance: the raw-text chip renders *before* curated matches, so typing `Vampire` shows `Block tag "Vampire"` above the curated `Vampire` tag. Blocking the raw text and blocking the curated tag are different operations with different blast radius: the id hits every character carrying that curated tag server-side; the keyword hits characters whose custom tag matches the string.

## Data shapes

- In: `List<CatalogTag> allTags` (`{int? id, required String name, String? slug}`), `Set<int> blockedTagIds`, `Set<String> blockedKeywords`.
- Server record (read by the owner): `JanitorBlockList { List<dynamic> bots, List<dynamic> creators, List<String> keywords, List<int> tags }`.
- Out: `onToggleTag(int)`, `onAddKeyword(String)`, `onRemoveKeyword(String)`, `onClear()`.
- Local: `_query` (trimmed), `_suggestions` (`List<String>`).

## Network / WebView contract

Only one call, through `fetchJanitorTagSuggestions(prefix)` in `services/janitor_provider.dart`:

```
GET https://janitorai.com/hampter/characters/tags/suggest?prefix=<Uri.encodeQueryComponent(prefix)>
response: {"suggestions": ["…", "…"]}     (each coerced with .toString())
```

- Empty/whitespace prefix ⇒ `const []`, **no request**.
- Any exception (including a Cloudflare block) ⇒ `const []`.
- Response shape is read defensively: `((data['suggestions'] as List?) ?? const [])`.

The block list itself is not touched here — the owner calls `fetchJanitorBlockedContent()` (`GET https://janitorai.com/hampter/profiles/mine/blocked-content`) and `saveJanitorBlockList()` (`PATCH https://janitorai.com/hampter/profiles/mine`, body `{"block_list":{"bots":[…],"creators":[…],"keywords":[…],"tags":[…]}}`). Per `services/janitor_session.dart`'s allowlist (`janitorReadIsPublic`), `hampter/profiles/...` is **not** a public read — this widget only works with a signed-in session, which is exactly why the owner hides it when `janitorAccountProvider.isLoggedIn` is false.

## Selectors, regexes and string literals

No regexes, no selectors (native Flutter, no DOM).

| literal | where |
| --- | --- |
| `catalog_blocked_tags` → `Blocked tags` | card header |
| `catalog_blocked_search` → `Block a tag...` | search field hint |
| `catalog_blocked_add_keyword` → `Block tag "{keyword}"` | raw-text chip, `namedArgs: {'keyword': _query}` |
| `catalog_clear_tags` → `Clear ({count})` | via `FilterClearButton` with `namedArgs: {'count': '$count'}` |
| `'#$id'` | fallback label for an unresolved blocked tag id |
| `Duration(milliseconds: 250)` | suggestion debounce |
| `.take(8)` | cap on curated matches and on remote suggestions, each independently |
| `EdgeInsets.fromLTRB(16, 6, 16, 10)` | card body padding |
| `Wrap(spacing: 6, runSpacing: 6)` | both chip wraps |
| `SizedBox(height: 12)` | gap between selected chips / after field |
| `Icons.block_rounded` | icon on the "Block tag" chip |

## State machine, retries, timings

- States: idle (empty query, no results) → loading (query set, fetch pending) → results or empty (query set, fetch settled). `_reset()` returns to idle.
- One timer, `250 ms`, cancelled on every keystroke and on `dispose`. No retry, no backoff, no pagination.
- Fetches are idempotent and safe to interleave because of the `q != _query` check; the loser is dropped silently rather than cached.
- No maximum on the blocked set, no dedupe against `allTags` beyond the `blockedTagIds` filter, and the owner sorts tags on save.

## Errors and user-visible messages

This widget shows no error text at all. The three failure modes and their real symptoms:

| failure | user sees |
| --- | --- |
| suggestion request fails / CF-blocked / no session | spinner stops, no suggestions; only the local curated matches and the raw-text chip remain |
| owner's initial block-list read fails | the *entire* section is absent (owner keeps `_blockList == null`) — no message, no retry |
| owner's PATCH on close fails | nothing visible; a microtask throws and the catalog is not reloaded |

## Persistence

None locally. The state is server-side account state: JanitorAI's `block_list` (`bots`, `creators`, `keywords`, `tags`). The owner replaces `tags` and `keywords` wholesale and preserves `bots`/`creators` from the prior fetch, sorted ascending before sending. Blocking a tag here changes the user's real janitorai.com account — it affects the site, not just Glaze.

## Porting notes for our SillyTavern port

1. **One control, two storage shapes.** Keep the id/keyword split in the data model (`tags: number[]`, `keywords: string[]`) and flatten only in the UI. Any port that renders two lists with different affordances loses the file's central design decision.
2. **The raw-text chip must always be offered** (when not already blocked) — it is what makes custom tags blockable without a server round-trip to identify them.
3. **Prefix search is the only discovery mechanism** for custom tags: `GET /hampter/characters/tags/suggest?prefix=…` with `{"suggestions": [...]}`. Restarting the query after each add is the upstream behaviour; a sticky query would be a deliberate improvement.
4. **Failure is silent upstream; make it loud here.** A `Block a tag...` field that answers "nothing" for a network error is indistinguishable from "no such tag". A JS port should surface a transient error row and keep the last good suggestion list.
5. **`#<id>` fallback** is the pattern to copy for any id-keyed list rendered from a partial cache: never drop an unknown id, render a legible placeholder.
6. **Guard ordering with a query token**, not a request generation counter — comparing against the *current* query is enough because the only interesting staleness is "a different query than the one on screen".
7. **Debounce 250 ms** matches the shared `FilterTagPicker` (same constant), so the port should use one debounce helper for both.

## Open questions

- Whether the JanitorAI block list limits the number of blocked tags/keywords (there is no client-side cap) — UNKNOWN — not determined from this file; `services/janitor_provider.dart` (which merely round-trips the record) would not settle it either; only the live API would.
- Whether a curated tag and a keyword with the same text both render as chips and both take effect (they appear to be independent: `_tagMatches` filters only `blockedTagIds`, `_keywordMatches` only `blockedKeywords`) — behaviour at the chip level is as described, but what the server does with both present is UNKNOWN — not determined from this file.
- Whether `FilterSearchField.onSubmitted` fires on IME "search" action on Android (affects whether the raw-text path is reachable by keyboard) — UNKNOWN — would be settled by `lib/shared/widgets/filter_tag_picker.dart`'s `FilterSearchField` implementation.
