# janitor_lorebooks_tab.dart

- **Path:** C:/Users/Gedeon/Documents/Coding/Glaze-stable/lib/features/catalog/widgets/janitor_lorebooks_tab.dart
- **Lines:** 250 (read in full: 1-250)
- **Role:** Read-only **Lorebooks** tab of the JanitorAI catalog character preview — it lists every lorebook script attached to the character, classified as public / scripted / closed, and deliberately offers no action.

## Purpose

The tab is an inventory, and its doc comment is the argument for that:

> "an inventory of what the character has, and nothing else.
> Downloading a public book and capturing/rebuilding a closed one both happen in the import flow — the Import button offers "Lorebooks" and "Character + lorebooks", which open the capture sheet (`showJanitorLorebookCaptureSheet`). Keeping the preview read-only means a lorebook is only ever pulled as part of an import the user actually asked for, instead of two places doing the same capture with different targets."

So the file exists to *inform* (does this character have lorebooks? which kinds? how much work will they be?) and to *route* the user at the Import button. Every action lives in `janitor_lorebook_capture_sheet.dart`.

This is also where the three-way lorebook taxonomy becomes visible to the user — the same taxonomy the whole capture/build pipeline is built around:

| kind | condition | user-facing description |
| --- | --- | --- |
| public (JSON) | `accessible == true`, `isJs == false` | `{} entries · downloads whole` |
| scripted (advanced / Nine API) | `isJs == true` | `Scripted (advanced) · rebuilt with your LLM` |
| closed (private) | `accessible == false && isJs == false` | `Private · recovered from the prompt` |

## Behaviour walkthrough

### `JanitorLorebookArgs`

```dart
class JanitorLorebookArgs {
  final String characterId;
  final String sourceUrl;
  final Map<String, dynamic> meta;      // raw /hampter metadata (for `scripts`)
  final bool definitionPublic;          // default false
}
```

Doc: "Context passed to the catalog-preview Lorebooks tab and to the capture sheet. Carries the JanitorAI character id, its source URL and the raw `/hampter` metadata (for the attached `scripts`)." Constructed once, in `widgets/catalog_detail_launcher.dart:311-318`, only when `widget.provider == CatalogProvider.janitor`:

```dart
JanitorLorebookArgs(
  characterId: widget.item.id,
  sourceUrl: _sourceUrl() ?? widget.item.id,
  meta: _janitorMeta ?? const {},
  definitionPublic: _definitionPublic,
)
```

and consumed by `character_detail_screen.dart:949` under the Prompts tab when the character has any lorebooks (`if (_hasLorebooks) … _TabSectionHeader(icon: Icons.menu_book_outlined, label: 'section_lorebooks'.tr())`, then `JanitorLorebooksTab(args: widget.janitorLorebookArgs!)`).

Note: this tab **does not use** `characterId`, `sourceUrl` or `definitionPublic` at all — it only passes `meta` to the fetcher. The other three fields exist for the capture sheet that shares the class.

### `initState` → `_load`

```dart
@override
void initState() { super.initState(); _load(); }

Future<void> _load() async {
  final books = await fetchPublicLorebooks(widget.args.meta);
  if (!mounted) return;
  setState(() { _books = books; _loading = false; });
}
```

No error branch: `fetchPublicLorebooks` never throws (each book is fetched with try/catch inside and degraded to `accessible: false`), so a network failure degrades the inventory into "closed lorebooks" rather than an error message. The tab has no retry and no refresh.

### `fetchPublicLorebooks(meta)` (context: `services/janitor_public_lorebook.dart`)

1. `lorebookScriptRefs(meta)` reads `meta['scripts']`, keeps entries where `(s['type'] == 'lorebook' || s['type'] == 'advanced') && s['id'] != null`, mapping each to `JanitorScriptRef {id: s['id'].toString(), title: (s['title'] ?? '').toString(), isPublic: s['is_public'] != false}`. (**`isPublic` is parsed but never used by this tab.**)
2. For each ref, sequentially (no concurrency): `GET https://janitorai.com/hampter/script/{scriptId}` through the WebView proxy, `jsonDecode`d.
3. Then, for the description: `GET https://janitorai.com/scripts/{scriptId}` (the public lorebook page) and parse `scriptPublishedContent.content` out of `window.mbxM.push(JSON.parse("…"))`, falling back to the `/hampter` record's `description`; the result is HTML-stripped.
4. `parseScriptEntries(rec)` handles `script` being either a JSON array or a JSON **string** holding an array.
5. `usable` = count of entries whose `content` is non-empty after trim.
6. If `usable == 0` and the `script` string is not JSON (i.e. it is JavaScript source), the book is returned as `isJs: true` with `jsSource`; otherwise `accessible: usable > 0`, `entryCount: usable`.

So "public" here means *downloadable whole*, "scripted" means *public source but generated at runtime*, "closed" means *only recoverable from the assembled prompt*.

### `build()`

Loading:

```dart
Padding(padding: const EdgeInsets.fromLTRB(16, 16, 16, 24), child: Row(children: [
  SizedBox(width: 16, height: 16, child: GlazeSpinner(color: cs.primary)),
  const SizedBox(width: 12),
  Text('catalog_lorebooks_loading'.tr(), style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant)),
]))
```

Loaded — `Padding(EdgeInsets.fromLTRB(16, 8, 16, 24))` around a `Column(crossAxisAlignment: CrossAxisAlignment.start)`:

```dart
final public = _books.where((b) => b.accessible || b.isJs).toList();
final closed = _books.where((b) => !b.accessible && !b.isJs).toList();
```

- if both empty: `Text('catalog_lorebooks_none'.tr())` at fontSize 12 / `onSurfaceVariant` — and **no** import hint (an early `if/else`, so the hint below only renders when something exists).
- else: if `public.isNotEmpty` → `_Title('catalog_lorebooks_public'.tr())`, 8 px, then each book row + 8 px. If `closed.isNotEmpty` → (12 px gap only when the public group rendered) `_Title('catalog_lorebooks_closed'.tr())`, 8 px, then rows. Then `SizedBox(height: 8)` and `_ImportHint()`.

Section order is fixed: public + scripted together under "Public lorebooks" (scripted books are in the `public` bucket because `b.isJs`), closed after.

### `_LorebookRow`

```dart
IconData get _icon {
  if (!book.accessible && !book.isJs) return Icons.lock_outline;
  return book.isJs ? Icons.code_rounded : Icons.menu_book_rounded;
}

String get _subtitle {
  if (!book.accessible && !book.isJs) return 'catalog_lorebook_kind_closed'.tr();
  if (book.isJs) return 'catalog_lorebook_kind_scripted'.tr();
  return 'catalog_lorebook_kind_public'.tr(args: [book.entryCount.toString()]);
}
```

Layout: `Container(padding: EdgeInsets.symmetric(horizontal: 12, vertical: 10), decoration: color cs.surfaceContainerHighest, BorderRadius.circular(8))`; a `Row` with the 18 px icon (colour `cs.onSurfaceVariant` when locked, else `cs.primary`), 10 px gap, then a `Column` of:

1. title — `book.title.isEmpty ? 'Lorebook' : book.title`, fontSize 13 / w600 / `onSurface`;
2. subtitle at fontSize 11 / `onSurfaceVariant`;
3. when `book.description.trim().isNotEmpty`: 4 px, then the trimmed description, `maxLines: 6`, `TextOverflow.ellipsis`, fontSize 11, `height: 1.35`, `onSurfaceVariant.withValues(alpha: 0.85)`.

Absolute literal: the fallback title is `'Lorebook'` — **not** localised, unlike every other string in the file.

The whole row is non-interactive: no `InkWell`, no tap target, nothing to open. That is the design, not an omission.

### `_ImportHint`

`Container(padding: EdgeInsets.all(10))`, `cs.surfaceContainerHighest`, `BorderRadius.circular(8)`, `Border.all(color: cs.primary.withValues(alpha: 0.3))`; `Row` of `Icons.info_outline_rounded` (size 16, `cs.primary`), 8 px, and `Text('catalog_lorebooks_import_hint'.tr())` at fontSize 11, `height: 1.35`, `onSurfaceVariant`.

### `_Title`

`Text(text, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: cs.onSurface))`.

## Data shapes

- `JanitorLorebookArgs { String characterId; String sourceUrl; Map<String, dynamic> meta; bool definitionPublic }`.
- `PublicLorebook { String id; String title; String description; bool accessible; int entryCount; List<dynamic> rawEntries; String? error; bool isJs; String jsSource }` (`services/janitor_public_lorebook.dart`), with `toLorebook({String? characterId})` and `toTavernJson()`.
- Input metadata slice: `meta['scripts'] = [{ id, title, type: 'lorebook'|'advanced', is_public }]`.
- Local state: `bool _loading = true`, `List<PublicLorebook> _books = const []`.

## Network / WebView contract

Two requests per lorebook, both through `JanitorWebViewProxy.instance.fetch` inside `services/janitor_public_lorebook.dart` (not in this file):

```
GET https://janitorai.com/hampter/script/{scriptId}
    -> { id, title, description, script }   (script = JSON string of an entries array, or JS source)
GET https://janitorai.com/scripts/{scriptId}
    -> HTML; description scraped from window.mbxM.push(JSON.parse("…")) store,
       key path scriptPublishedContent.content, fallback script.description
```

Both are cheapest-effort: the `/hampter/script/{id}` failure yields `PublicLorebook(error: e.toString())` (rendered as a *closed* book, since `accessible`/`isJs` are false), and the `/scripts/{id}` page failure yields `''` (description omitted). The description parse regex lives there: `JSON\.parse\("((?:[^"\\]|\\.)*)"\)` with a double `jsonDecode` (once as a quoted string, once as the payload).

## Selectors, regexes and string literals

No regexes or selectors in this file.

| literal | rendered as |
| --- | --- |
| `catalog_lorebooks_loading` | `Loading lorebooks…` |
| `catalog_lorebooks_none` | `No lorebooks attached.` |
| `catalog_lorebooks_public` | `Public lorebooks` |
| `catalog_lorebooks_closed` | `Closed lorebooks` |
| `catalog_lorebook_kind_public` | `{} entries · downloads whole` (`args: [entryCount]`) |
| `catalog_lorebook_kind_scripted` | `Scripted (advanced) · rebuilt with your LLM` |
| `catalog_lorebook_kind_closed` | `Private · recovered from the prompt` |
| `catalog_lorebooks_import_hint` | `Lorebooks are pulled from the Import button: pick "Lorebooks" or "Character + lorebooks".` |
| `section_lorebooks` | `section_lorebooks` key, header used by the host screen |
| `'Lorebook'` | literal fallback title (not localised) |
| `Icons.lock_outline`, `Icons.code_rounded`, `Icons.menu_book_rounded`, `Icons.info_outline_rounded` | row/hint icons |
| `maxLines: 6`, `fontSize 13/11/12`, `height: 1.35`, `alpha 0.85`, `circular(8)`, `12/10/8/4` spacing | layout constants |

## State machine, retries, timings

Two states only: `loading` and loaded. There is no error state, no empty-vs-failed distinction, no retry, no timeout, and no pagination. Sequential fetches: N books cost 2N requests, one after another (a character with three books ⇒ six sequential WebView round-trips, each of which may have to wait on CF clearance — inferred cost, not a stated timeout).

Consequence to be aware of in a port: on a slow/VPN route, `/hampter/script/{id}` failures silently reclassify public books as "Private · recovered from the prompt", which steers the user into the (expensive, LLM-based) closed-book path.

## Errors and user-visible messages

None. There is no `error` render path; `PublicLorebook.error` is never displayed by this tab. The only signals are the three kind subtitles, one of which (`Private · recovered from the prompt`) can be produced by a transient network error.

## Persistence

None. The tab is rebuilt from `meta` each time the preview opens; `PublicLorebook` records are not cached by this widget (the capture sheet refetches). `_books` is discarded with the widget.

## Porting notes for our SillyTavern port

1. **Keep the inventory read-only and put every mutation behind the import flow.** This is the file's whole thesis: one place performs a capture, so targets and accounting cannot diverge. In the vault, that means the lorebook list in a JanitorAI character preview should link to the import action rather than offer "download"/"rebuild" buttons of its own.
2. **Reproduce the three-way classification, including the scripted middle case**, because it determines user cost: `downloads whole` (free), `rebuilt with your LLM` (expensive, deterministic input), `recovered from the prompt` (most expensive — needs an account, an injected chat, and an LLM build). The port's copy should keep that progression legible.
3. **Do not show an entry count you did not verify.** Upstream counts entries whose `content` trims non-empty and shows `accessible == usable > 0` — a book with keys but empty content is *closed*, not public.
4. **Distinguish "no lorebooks" from "could not read lorebooks".** Upstream conflates them (and shows no import hint at all when empty). Our port can do better cheaply: surface `PublicLorebook.error` and retry.
5. **Preserve `meta['scripts']` verbatim in whatever state the preview keeps**, since both this tab and the capture sheet derive everything from it; do not normalize `type: 'lorebook'|'advanced'` away.
6. `isPublic` (`is_public != false`) is parsed and then ignored for classification — access is decided empirically by whether the download yielded entries. Follow the empirical rule: a book marked public that 403s must land in "closed", not in "public".

## Open questions

- Whether excluding `is_public` is deliberate or an oversight — inference from the code (classification is purely empirical); the capture sheet may use it — UNKNOWN from this file, settled by `widgets/janitor_lorebook_capture_sheet.dart`.
- Whether the tab refreshes after an import performed from the same preview — no listener/refresh path is visible here; UNKNOWN — settled by `catalog_detail_launcher.dart` / `character_detail_screen.dart`.
- Whether `fetchPublicLorebooks` is parallelised anywhere else to hide latency — this file awaits it once; UNKNOWN for the capture sheet.
- Whether the host requires lorebooks to exist before rendering the tab at all (`_hasLorebooks` in `character_detail_screen.dart`), so a character whose `scripts` array is empty never shows "No lorebooks attached." — indicated by the caller, not this file; `character_detail_screen.dart` would settle it.
