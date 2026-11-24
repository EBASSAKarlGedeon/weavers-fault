# janitor_provider.dart

- **Path:** `C:/Users/Gedeon/Documents/Coding/Glaze-stable/lib/features/catalog/services/janitor_provider.dart`
- **Lines:** 577 (read to the final `}`; verified with `awk 'END{print NR}'`)
- **Role:** The JanitorAI catalog provider: every `/hampter/...` read endpoint the app uses (search/listing, curated tags, popular custom tags, creator pages, block list, comments, character metadata) plus the mapping of raw JSON rows into Glaze `CatalogItem` / `DownloadedCharacter`.

## Purpose

This is the single HTTP surface for JanitorAI in the port, and it is deliberately thin: every request goes through `JanitorWebViewProxy.instance.fetch(url)` — an offscreen `janitorai.com` WebView that attaches the Supabase bearer token in-page, clears Cloudflare and rides out the admission queue (see `janitor_webview_proxy.md`). Nothing here builds its own HTTP client, sets its own headers or handles auth. The port must reproduce the exact URL shapes and query-parameter spellings below; the transport layer is not part of this file's contract beyond "GET this URL, get the raw body back as a String".

There is no API key, no base-URL setting and no per-provider configuration: the host is hard-coded as `https://janitorai.com`, the image CDN as `https://ella.janitorai.com`.

## Behaviour walkthrough

**Block list (`JanitorBlockList`, `fetchJanitorBlockedContent`, `saveJanitorBlockList`)**

`fetchJanitorBlockedContent()` GETs `https://janitorai.com/hampter/profiles/mine/blocked-content` and reads four fields: `bots` (opaque JSON list kept verbatim), `creators` (opaque list), `keywords` (list coerced with `toString()`), `tags` (list filtered by `whereType<num>()` then `.toInt()`, i.e. numeric tag ids). `copyWith` only allows replacing `tags` and `keywords` — `bots`/`creators` are comment-documented as opaque because the PATCH replaces the whole `block_list` object and would otherwise wipe them.

`saveJanitorBlockList(list)` re-sends **all four** fields as one JSON body and PATCHes `https://janitorai.com/hampter/profiles/mine`:

```
{"block_list":{"bots":[…],"creators":[…],"keywords":[…],"tags":[…]}}
```

It is the only mutating call in the file, and the only one that passes `method:`/`body:` to the proxy. `_profileUrl` is `https://janitorai.com/hampter/profiles/mine`; `_blockedContentUrl` is the same plus `/blocked-content`.

**Tag vocabularies**

- `fetchJanitorTagSuggestions(prefix)` → `https://janitorai.com/hampter/characters/tags/suggest?prefix=<Uri.encodeQueryComponent(prefix)>`, reads `{"suggestions":[…]}`, returns `[]` on empty/whitespace prefix and swallows every exception (`catch (_) { return const []; }`). These suggestions are free-text *keywords* to block, not tag objects.
- `fetchJanitorTags()` → `https://janitorai.com/hampter/tags`, expects a **bare JSON array** (`(await _janitorFetch(tagsUrl) as List)` — a map body throws and is caught). Each element gives `{"id": int, "name": String, "slug": String?}` → `CatalogTag`. It also builds `_janitorTagMap` (id → name) used for id-only rows. Guarded by a module-level `_tagsFetched` bool: fetched once per process, never invalidated. On any throw, if `_cachedJanitorTags` is empty it falls back to `_fallbackTagMap`; note `_tagsFetched` is then left `false`, so the next caller retries the network.
- `fetchJanitorTopCustomTags()` returns the cached `top_custom_tags` or, if empty, fetches `https://janitorai.com/hampter/characters?page=1&mode=sfw&sort=trending24` and harvests them. Failure is silently ignored (the sheet then offers only curated tags).
- `parseTopCustomTags(raw)` accepts each item as a bare `String`, or a Map carrying `name` / `tag` / `slug`; trims; dedupes case-insensitively (`seen.add(name.toLowerCase())`); preserves server rank order.
- `withPopularCustomTags(curated, popular)` appends the popular custom tags *after* the curated ones as id-less `CatalogTag(name: …)`, skipping any name already covered case-insensitively.

**Search (`janitorSearch`)**

Sort aliasing: `filters.sort` is passed through verbatim except `'trending_24h'` → `'trending24'` and `'newest' | 'latest'` → `'latest'`. The default from `CatalogFilters` is `'trending'`.

Query string, built into a `StringBuffer` then appended to `https://janitorai.com/hampter/characters?`:

```
page=<page>&mode=<all|sfw>&sort=<sortMode>
&search=<Uri.encodeComponent(query)>            // only when query.isNotEmpty
&tag_id[]=<id>                                  // once per filters.tagIds
&custom_tags[]=<Uri.encodeComponent(name)>      // once per filters.tagNames
```

`mode` is `all` when `filters.nsfw`, else `sfw`. Note the asymmetry: the free-text search uses `Uri.encodeComponent`, the tag names use `Uri.encodeComponent`, but `page`/`mode`/`sort` are interpolated raw.

Response handling is dual-shape: if the body is a `List`, hits are the body directly and `total` is `hits.length`; otherwise hits are `data['characters']` else `data['data']` else `[]`, and `total` is `data['total']` as int else `0`. Every response also harvests `top_custom_tags` into `_cachedTopCustomTags` (only when non-empty) — "harvested from the search that was going to happen anyway".

**Creator pages (`janitorFetchCreatorCharacters`, `janitorFetchCreatorProfile`)**

There is no per-profile character endpoint and no profile-by-id endpoint; both are emulated against the ordinary listing/search.

- `janitorFetchCreatorCharacters(creatorId)`: `page=<n>&sort=latest&mode=<all|sfw>&user_id[]=<Uri.encodeQueryComponent(creatorId)>`. Hits come from `data` then `characters`. `total` is `data['total']`, page `size` is `data['size']` else the constant `34`. `hasMore` is `hits.isNotEmpty && (total == null ? hits.length >= size : page * size < total)`.
- `_janitorListingPageSize = 34` — comment: "Fixed by the server; a size parameter is ignored."
- `janitorFetchCreatorProfile(creatorId, name: …)`: returns null on empty name; GETs `https://janitorai.com/hampter/profiles/search?mode=foryou&page=1&search=<Uri.encodeQueryComponent(name)>`, takes `data['data']` (or the body itself if it is a list) and returns the first row where `row['id'] == creatorId`. That is a **name-driven** lookup: a renamed creator or an ambiguous name yields null.

**Character metadata and conversion**

- `janitorFetchCharacterMeta(id)` GETs `https://janitorai.com/hampter/characters/<id>` and casts the decoded body `as Map<String, dynamic>` (a non-map body throws a `TypeError`, not a friendly error).
- `janitorDefinitionPublic(meta)` mirrors JAR's `isCardPublic`: true iff `showdefinition == true` **and** either `personality` or `scenario` is non-empty after trim.
- `janitorAllowsProxy(meta)` is `meta == null || meta['allow_proxy'] != false` — absent field means allowed. Its doc names the exact refusal: `403 Proxies are forbidden for this character`.
- `_convertToGlaze(m)` builds `DownloadedCharacter`/`CharacterData`. Look at the field mapping because it is counter-intuitive:
  - `name` ← `name` ?? `chat_name` ?? `'Unknown'`
  - **`description` ← `personality` only** (no fallback). The comment is a hard rule: a closed card hides `personality`, and falling back to the row's `description` would dump the public bio (often HTML) into the prompt. Empty `description` is the *signal* that the definition is unavailable.
  - `personality` ← `''` (always), `systemPrompt` ← `''`, `postHistoryInstructions` ← `''`, `characterBook` ← `null`
  - `scenario` ← `scenario`; `mesExample` ← `example_dialogs` ?? `mes_example` ?? `example_dialogs` (the duplicate is in the source)
  - `creatorNotes` ← `description` ?? `creator_notes` (so the bio survives as creator notes)
  - greetings via `normalizeGreetings(primary: first_message ?? first_mes, others: greetingList(first_messages))` — comment: `first_messages` is the whole set *including* the opening line, so mapping it straight to alternates double-listed the greeting.
  - `tags` = `[isNsfw ? 'NSFW' : 'SFW', ...standardTags, ...custom_tags.map((t) => '#$t')]`, deduped via `toSet()`. Tag source: if `m['tags']` is a List, each item is a `String` or a map with `name` ?? `slug`; else `m['tagIds']` is translated through `_janitorTagMap`. Any tag equal to `'limitless'` (case-insensitive) is dropped.

**Reviews**

`janitorFetchReviews(characterId, page: 1, size: 20, sortBy: 'likes')` GETs `https://janitorai.com/hampter/reviews/<characterId>?page=<p>&size=<s>&sortBy=<sortBy>`. The endpoint returns a **bare JSON array** with no total, so end-of-list is detected by a short page: `kCatalogCommentsPageSize = 20` and "a full page is the signal there *may* be more". `_normalizeReview` reads `user_profiles.name` ?? `user_profiles.user_name` ?? `'Anonymous'`, plus `content`, `id`, `like_count`, `comment_count`, `is_pinned`, `user_profiles.is_verified`, `user_profiles.plusbadge`, `created_at` (parsed with `DateTime.tryParse`), `user_profiles.avatar` and `user_profiles.user_name`.

**Avatars**

- `resolveJanitorAvatar(url)`: `http…` → unchanged; leading `/` → `https://ella.janitorai.com<url>?width=400`; no `/` at all → `https://ella.janitorai.com/bot-avatars/<url>?width=400`; otherwise `https://ella.janitorai.com/<url>?width=400`.
- `resolveJanitorUserAvatar(url)`: same rules but `…/user-avatars/<url>?width=100` and `?width=100` for the rooted/full-path cases; null/empty → null.

**Listing row → `CatalogItem` (`_normalizeHit`)**

`id` ← `id` ?? `''`; `name` ← `name` ?? `bot_name` ?? `'Unknown'`; `avatarUrl` ← `avatar` ?? `image`; `description` ← `description` ?? `short_description`; `tokens` ← `totalToken` ?? `total_tokens` ?? 0 (`as int`, so a JSON double throws); `chatCount` ← `stats.chat` ?? `public_chat_count`; `messageCount` ← `stats.message` ?? `public_message_count`; `creator` ← `creatorUsername` ?? `creator_name` ?? `creator`; `creatorId` ← `creator_id` ?? `creatorId`; `nsfw` ← `isNsfw` ?? `is_nsfw` (this order here, **reversed** in `_convertToGlaze`, which checks `is_nsfw` first); `slug` ← `slug` ?? `id`; `source` is the literal `'janitor'`.

`_janitorFetch` wraps the proxy: it `debugPrint`s `[CF] janitorFetch: <first 80 chars>` and `jsonDecode`s the body — so **every** endpoint above must return JSON, including the two that expect a bare array.

## Data shapes

```
JanitorBlockList { bots: List<dynamic>, creators: List<dynamic>, keywords: List<String>, tags: List<int> }
JanitorScriptRef  { id: String, title: String, isPublic: bool }   // from /hampter/characters/{id}.scripts
CatalogTag        { id: int?, name: String, slug: String? }
CatalogItem       { id, name, avatarUrl, description, tags, tokens, chatCount, messageCount, creator, creatorId, nsfw, slug, source }
CatalogComment    { id, content, authorName, authorUserName, avatarUrl, likeCount, replyCount, isPinned, isVerified, hasPlus, createdAt }
```

`_fallbackTagMap` is a hard-coded `int → String` table of **56** curated JanitorAI tags, used when `/hampter/tags` fails: `1: 'Male'`, `2: 'Female'`, `3: 'Non-binary'`, `4: 'Celebrity'`, `5: 'OC'`, `6: 'Fictional'`, `7: 'Real'`, `8: 'Game'`, `9: 'Anime'`, `10: 'Historical'`, `11: 'Royalty'`, `12: 'Detective'`, `13: 'Hero'`, `14: 'Villain'`, `15: 'Magical'`, `16: 'Non-human'`, `17: 'Monster'`, `18: 'Monster Girl'`, `19: 'Alien'`, `20: 'Robot'`, `21: 'Politics'`, `22: 'Vampire'`, `23: 'Giant'`, `24: 'OpenAI'`, `25: 'Elf'`, `26: 'Multiple'`, `27: 'VTuber'`, `28: 'Dominant'`, `29: 'Submissive'`, `30: 'Scenario'`, `31: 'Pokemon'`, `32: 'Assistant'`, `34: 'Non-English'`, `36: 'Philosophy'`, `38: 'RPG'`, `39: 'Religion'`, `41: 'Books'`, `42: 'AnyPOV'`, `43: 'Angst'`, `44: 'Demi-Human'`, `45: 'Enemies to Lovers'`, `46: 'Smut'`, `47: 'MLM'`, `48: 'WLW'`, `49: 'Action'`, `50: 'Romance'`, `51: 'Horror'`, `52: 'Slice of Life'`, `53: 'Fantasy'`, `54: 'Drama'`, `55: 'Comedy'`, `56: 'Mystery'`, `57: 'Sci-Fi'`, `59: 'Yandere'`, `60: 'Furry'`, `61: 'Movies/TV'`. Ids 33, 35, 37, 40, 58 are absent — do not "fix" the gaps.

## Network / WebView contract

All calls are `GET` through `JanitorWebViewProxy.instance.fetch(url)` except one `PATCH`. The proxy contract (from `janitor_webview_proxy.dart:_rawFetch`) is fixed and identical for every call here:

- injected JS sets `headers = { "Accept": "application/json, text/plain, */*" }`, adds `headers["authorization"] = "Bearer " + token` from its in-page token finder, and calls `fetch(url, {method, headers, credentials:"include"})`;
- only when a body is given does it add `headers["Content-Type"] = "application/json"` and `opts.body`;
- it returns `{status, body, auth}`; the Dart side `.timeout(const Duration(seconds: 25))` per JS call and maps a timeout/JS error to `status: -1`.

Failure policy in `_fetchLocked` (relevant because every provider call inherits it): waiting-room HTML under HTTP 200 → recover and retry **twice**; `403`/`503`/`200 + "Access Restricted"` → reload (re-run Turnstile) and retry, then escalate to a visible challenge and retry again, then throw `JanitorCfException`; `401` → force session refresh and retry once, then (for public reads) retry anonymously once, then throw `JanitorAuthException`; `status >= 400` → `Exception('HTTP <status>')`.

Endpoint inventory (verbatim):

| # | Method | URL |
|---|---|---|
| 1 | GET | `https://janitorai.com/hampter/characters?page=<n>&mode=<all\|sfw>&sort=<s>[&search=…][&tag_id[]=…][&custom_tags[]=…]` |
| 2 | GET | `https://janitorai.com/hampter/tags` |
| 3 | GET | `https://janitorai.com/hampter/characters/tags/suggest?prefix=<p>` |
| 4 | GET | `https://janitorai.com/hampter/characters/<id>` |
| 5 | GET | `https://janitorai.com/hampter/profiles/mine/blocked-content` |
| 6 | PATCH | `https://janitorai.com/hampter/profiles/mine` |
| 7 | GET | `https://janitorai.com/hampter/profiles/search?mode=foryou&page=1&search=<name>` |
| 8 | GET | `https://janitorai.com/hampter/reviews/<id>?page=<p>&size=<s>&sortBy=<s>` |
| 9 | GET | `https://ella.janitorai.com/bot-avatars/<file>?width=400`, `https://ella.janitorai.com/user-avatars/<file>?width=100` (plain image GETs, not proxied) |

## Selectors, regexes and string literals

No DOM selectors and no regexes in this file. Literals that must survive the port: `'https://janitorai.com/hampter/profiles/mine/blocked-content'`, `'https://janitorai.com/hampter/profiles/mine'`, `'https://janitorai.com/hampter/characters'`, `'https://janitorai.com/hampter/characters/tags/suggest?prefix='`, `'https://janitorai.com/hampter/tags'`, `'https://janitorai.com/hampter/profiles/search'`, `'https://janitorai.com/hampter/reviews/'`, `'https://ella.janitorai.com/bot-avatars/'`, `'https://ella.janitorai.com/user-avatars/'`, `'block_list'`, `'suggestions'`, `'top_custom_tags'`, `'characters'`, `'data'`, `'total'`, `'size'`, `'source: 'janitor'`, the sort tokens `'trending24'` / `'latest'` / `'trending'` / `'trending_24h'`, `'all'` / `'sfw'`, `'Anonymous'`, `'Unknown'`, `'limitless'`, `'#<tag>'`, `'user_id[]='`, `'tag_id[]='`, `'custom_tags[]='`, `'403 Proxies are forbidden for this character'` (doc comment), `'[CF] janitorFetch: '`.

## State machine, retries, timings

- No timers or retry loops in this file. `_tagsFetched` is a one-shot latch per process; `_cachedJanitorTags`, `_janitorTagMap` and `_cachedTopCustomTags` are module-level mutable caches with no TTL and no invalidation.
- `_janitorListingPageSize = 34`; `kCatalogCommentsPageSize = 20`; comment `sortBy` default is `likes`.
- Retry/timeout behaviour is entirely the proxy's: 25 s per injected JS `fetch`, up to 3 attempts for queue/CF, up to 2 for 401. Avatar URLs request `width=400` (bots) and `width=100` (users).

## Errors and user-visible messages

This file surfaces no user-facing text of its own. Everything is either swallowed (`fetchJanitorTagSuggestions`, `fetchJanitorTopCustomTags`, `fetchJanitorTags`) or propagates the proxy's exceptions (`JanitorCfException`, `JanitorQueueException`, `JanitorAuthException`, `Exception('WebView fetch failed')`, `Exception('HTTP <status>')`), which the UI labels via `catalog_error_source.dart` / `catalog_error_labels.dart`.

## Persistence

None. Nothing is written to disk, prefs or storage; the tag caches live only in process memory. The block list is persisted **server-side** by the PATCH.

## Porting notes for our SillyTavern port

- **Transport.** In our extension there is no offscreen WebView. Every URL above must be reproduced with the browser's own `fetch(url, {credentials: 'include'})` against `janitorai.com` so the site's own session cookie is used, plus a `Bearer` token found the way the site's client does. In a page served from our ST origin this is cross-origin, so CORS is the first blocker — measure it before porting anything else. If CORS refuses, the fallback is a `GM_xmlhttpRequest`-style path or a server-side proxy in our Node backend, both of which lose `cf_clearance`.
- **Reproduce literally:** the query-parameter spellings `tag_id[]`, `custom_tags[]`, `user_id[]`, `mode=all|sfw`, `sort=trending24`, `size=20&sortBy=likes`, the `34` page size, the `?width=400`/`?width=100` CDN rules, the `block_list` PATCH body shape (whole-object replacement, bots/creators echoed back), and the two fallback chains for tag ids vs. tag objects.
- **Do not reproduce:** `_tagsFetched` as a permanent latch (a long-lived ST session should be able to re-read tags), and the Dart `as int` casts (`tokens`, `total`, `size`) which throw on JSON doubles — use `Number(x) || 0`.
- **Fragile:** `janitorFetchCreatorProfile` depends on a name search and exact id equality; `janitorFetchCharacterMeta` assumes a map; `_convertToGlaze`'s `description ← personality` invariant is load-bearing (it is what tells the extractor the definition is closed) — a port that "helpfully" falls back to `description` will silently poison every closed-card import; the `nsfw` key precedence differs between `_normalizeHit` and `_convertToGlaze`.
- **Dart-only scaffolding:** `debugPrint`, the `@visibleForTesting` hooks elsewhere, `CatalogTag`/`CatalogItem`/`DownloadedCharacter` types (map to our own objects), `greetingList`/`normalizeGreetings` (we have `greeting_normalizer` equivalents in the extension already).

## Open questions

- Whether `top_custom_tags` requires a signed-in session: the code fetches it with `mode=sfw&sort=trending24`, but the listing itself may 401 without a session. Not determined from this file — `janitor_webview_proxy.dart:_fetchLocked` + `janitorReadIsPublic` would settle whether that path is treated as a public read.
- Whether `/hampter/characters/{id}` returns `allow_proxy` for anonymous callers, and whether `showdefinition` is present when logged out. Settled by `janitor_extractor.dart` capture flow, not here.
- Exact `stats` shape (`stats.chat` / `stats.message` are accessed without null-guarding `stats`) — UNKNOWN — not determined from this file; a live response or `datacat_provider.dart`'s normalizer would settle it.
