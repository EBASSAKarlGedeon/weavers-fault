# janitor_session.dart

- **Path:** C:/Users/Gedeon/Documents/Coding/Glaze-stable/lib/features/catalog/services/janitor_session.dart
- **Lines:** 123 (read in full: 1-123)
- **Role:** Five pure predicates that decide (a) which cookies must survive a Cloudflare cookie wipe, (b) what expiry a restored auth cookie gets, (c) whether a stored Supabase JWT is spent, and (d) whether a `401`ed request may be retried anonymously.

## Purpose

"Pure helpers for keeping a JanitorAI account session alive across app launches and Cloudflare challenges. Kept out of the WebView proxy so both rules — what makes a stored session cookie survive, and when the access token it carries has to be refreshed — are testable without a WebView." Nothing here performs network or platform IO; all platform effects are in the callers (`janitor_webview_proxy.dart`, `widgets/catalog_grid.dart`).

This is the file that encodes *why* a session gate exists at all: the extraction pipeline mutates account state (persona, chat, proxy preset, api-settings), so losing the session mid-run is not a cosmetic error — it desynchronises the account. It also encodes the rule that **browsing is anonymous-capable while capture is not**.

## Behaviour walkthrough

### `isJanitorAuthCookie(String name)`

```
name.startsWith('sb-') && name.contains('-auth-token')
```

Doc: "one of the Supabase session cookies JanitorAI signs in with (`sb-<ref>-auth-token`, plus its `.0`, `.1`, … chunks). These are the only cookies that must survive a Cloudflare cookie wipe: lose one chunk and the session is gone, which is what 'logged out again' looks like to the user."

Consequence for a port: the cookie *set* is identified, not the individual cookie's role — no attempt to parse which chunk is which; all matching cookies are preserved verbatim and re-set.

### `janitorAuthCookieExpiry(int? readBackMs, {required int nowMs})`

```
const minimumPlausible = Duration(days: 2);
const supabaseDefault = Duration(days: 400);
if (readBackMs != null && readBackMs - nowMs >= minimumPlausible.inMilliseconds) return readBackMs;
return nowMs + supabaseDefault.inMilliseconds;
```

The reasoning is spelled out and is the interesting part: the expiry read back from the platform cannot be trusted. "Android's WebView returns no attributes at all unless `GET_COOKIE_INFO` is supported, and when it is, a `Max-Age` is converted as `now + maxAge` **milliseconds** instead of seconds — so a 400-day cookie reads back as roughly nine hours." Re-setting either value downgrades a persistent login to something that dies with the process (a null expiry makes it session-only). So a read-back expiry is only kept when it is at least 2 days out; anything missing or "suspiciously near" is replaced with Supabase's own 400-day horizon.

Return value is epoch **milliseconds**, matching `CookieManager.setCookie(expiresDate:)`.

### `janitorTokenExpiry(String jwt)`

Splits on `'.'`, requires exactly 3 parts, base64url-decodes part 1 (`base64Url.normalize`), `jsonDecode`s it, requires a `Map`, reads `exp`, requires `num`, and returns `DateTime.fromMillisecondsSinceEpoch(exp.toInt() * 1000, isUtc: true)`. Any failure (wrong part count, bad base64, non-JSON, non-map, non-numeric `exp`) returns `null` — `on Object` catch, so it never throws.

### `isJanitorTokenExpired(String jwt, {Duration skew = const Duration(seconds: 60), DateTime? now})`

`expiry == null` ⇒ `false` ("A token with no readable `exp` is treated as usable — a request that fails says more than a guess here"). Otherwise `at = (now ?? DateTime.now().toUtc()).add(skew)` and expired iff `!expiry.isAfter(at)` — i.e. a 60-second pre-emptive window so a request does not arrive after the token lapsed.

The doc explains the operational failure: JanitorAI's Supabase access token lives "about an hour", the refresh token beside it in the same cookie "for weeks", and Glaze never refreshes the pair itself — "the page's own Supabase client does, on load". A perfectly valid session therefore hands out a stale JWT the first time the app is opened the next day, every authenticated call answers 401 and reads as "session expired, log in again" when nothing of the sort happened.

### `janitorReadIsPublic(String url, {String method = 'GET'})`

An explicit **allowlist**, GET only:

1. `if (method.toUpperCase() != 'GET') return false;`
2. `Uri.parse(url)` inside `try` — `FormatException` ⇒ `false`.
3. `segments = uri.pathSegments`; require `segments.length >= 2 && segments.first == 'hampter'`.
4. `path = segments.skip(1).toList()`, then `switch (path.first)`:
   - `'characters'` ⇒ `path.length <= 2 || (path.length == 3 && path[1] == 'tags' && path[2] == 'suggest')` — i.e. the feed/search (`/hampter/characters?...`, one segment), one card (`/hampter/characters/{id}`), and tag autocomplete (`/hampter/characters/tags/suggest`).
   - `'tags'` ⇒ `path.length == 1`.
   - `'reviews'` ⇒ `path.length == 2` (`/hampter/reviews/{id}`, query string not counted in `pathSegments`).
   - default ⇒ `false`.

The doc gives the two reasons the list is an allowlist rather than a block list: (a) a spent JWT that cannot be refreshed took the whole Discover tab down — "search and the next page of the feed both ended at 'session expired (401)', which names a fix ('log in again') that does not apply and offers no way back"; (b) "An account-bound call retried anonymously does not fail — it succeeds and describes somebody else, or nobody: a block list read without a session is an empty block list, which would then be written back over the real one. So anything not known to be public is refused here, including the capture flow's reads of chats, personas, scripts and API settings."

Note the path predicate is *not* purely structural: `/hampter/characters/tags/suggest` is public, but `/hampter/characters/{id}/tags` (3 segments, path[1] != 'tags') is not — the extra condition is what distinguishes them.

## Data shapes

- Cookie names: `sb-<ref>-auth-token`, optionally suffixed `.0`, `.1`, … (chunk index not interpreted here — see `_findTokenJs` in the proxy, which joins chunks by numeric index before decoding).
- JWT: three dot-separated base64url segments; payload JSON with `exp` in **seconds** (converted `* 1000`).
- Cookie expiry: epoch **milliseconds** (`int`), matching `CookieManager.setCookie`'s `expiresDate`.
- URL paths accepted: `/hampter/characters[?query]`, `/hampter/characters/{id}`, `/hampter/characters/tags/suggest`, `/hampter/tags`, `/hampter/reviews/{id}`.

## Network / WebView contract

No network calls. It defines the retry policy applied to them; the actual in-page fetch lives in `_rawFetch`, which attaches

```
headers = { "Accept": "application/json, text/plain, */*" }
if (token) headers["authorization"] = "Bearer " + token
opts = { method, headers, credentials: "include" }   // + Content-Type: application/json when a body is sent
```

with `callAsyncJavaScript` and a `25s` timeout. The decisions this file feeds:

- `_refreshSession({force})` — returns early when `!force && !isJanitorTokenExpired(token)`, otherwise reloads the page and polls `_readAccessToken` every `400ms` for `8s`.
- `_fetchLocked` — on `result.status == 401`: `_refreshSession(force: true)`, retry once; if still `401` **and** `janitorReadIsPublic(url, method:)`, retry with `anonymous: true` (token omitted, `__glazeFindToken()` replaced by `null`); if still `401`, `throw const JanitorAuthException()`.
- `catalog_grid.dart` `_onCreated` — reads all `janitorai.com` cookies, keeps `before.where((c) => isJanitorAuthCookie(c.name))`, `deleteAllCookies()`, then re-sets each with `path: '/'`, `expiresDate: janitorAuthCookieExpiry(c.expiresDate, nowMs: nowMs)`, `isSecure: true`, `sameSite: HTTPCookieSameSitePolicy.LAX` — deliberately *not* re-using the attributes read back.

## Selectors, regexes and string literals

No regexes, no DOM. Literals: `'sb-'`, `'-auth-token'`, duration constants `Duration(days: 2)`, `Duration(days: 400)`, `Duration(seconds: 60)` (default skew), path segment strings `'hampter'`, `'characters'`, `'tags'`, `'suggest'`, `'reviews'`. Nothing user-visible.

## State machine, retries, timings

- Token expiry check: `skew = 60s` default; `exp` in seconds; unreadable `exp` ⇒ "not expired".
- Cookie expiry: keep read-back when `>= now + 2 days`; else `now + 400 days`.
- Downstream (for context, not in this file): refresh poll `400ms` × `8s`; fetch JS timeout `25s`; one forced-refresh retry; one anonymous retry; `401` after that ⇒ `JanitorAuthException`.
- The cookie restore is all-or-nothing per cookie (`try` around each `setCookie`, failure logged as `[CF] auth cookie restore error (<name>): <e>`), so a partial restore is possible and means "some chunk lost" — which is exactly the failure this file is trying to prevent.

## Errors and user-visible messages

None here. `JanitorAuthException.toString()` is `'Janitor.AI session expired (401)'` (defined in `janitor_webview_proxy.dart`). The only log lines belong to callers: `[CF] auth cookie restore error (...)`, `access token stale (force=$force) — reloading to refresh it`, `session still stale after reload — the refresh token is gone too`, `401 persists — retrying the read without the account token`.

## Persistence

No storage of its own — it defines the rules for persisting the Supabase session that lives in the WebView cookie jar (`sb-*-auth-token*`), which is the only durable auth state. Related durable state elsewhere: the display name in `shared_preferences` under `gz_janitor_user_name` (`janitor_account_provider.dart`), and the in-memory refusal cache `_refusals` keyed by character id in the proxy.

## Porting notes for our SillyTavern port

Two different worlds to keep apart:

1. **If the extension captures inside a page the user is already logged into** (SillyTavern already holds a `janitorai.com` session in the browser or fetches through a proxy), the cookie-wipe protection is irrelevant: browsers do not wipe the jar. Keep `isJanitorAuthCookie` only if we ever add our own "re-solve Cloudflare" flow that clears cookies.
2. **Keep the anonymous-retry allowlist idea**, not necessarily its exact paths. The contract worth reproducing: *only* known-public GETs may be retried without credentials, because an account-bound read retried anonymously silently returns someone else's (or empty) data — the block-list example is a data-loss bug, not a UX bug. In our extension the equivalent risky reads are persona lists, chat lists, `api-settings`, and `profiles/mine`.
3. **`isJanitorTokenExpired` semantics** (60 s skew, unknown `exp` ⇒ usable) are cheap to port and prevent a whole class of "log in again" false alarms, but only matter if we read the JWT at all. If we rely on the browser's own session (recommended), skip `janitorTokenExpiry`/`isJanitorTokenExpired` entirely — the page refreshes its own token.
4. **`janitorAuthCookieExpiry`'s 2-day / 400-day rule is pure Android-WebView workaround.** Do not port it to a browser; the analogous browser hazard is `document.cookie` writing a session cookie over a persistent one, which we simply should not do.
5. What must be reproduced literally if we do implement session gating: the *401 ⇒ refresh-once ⇒ anonymous-retry-if-public ⇒ fail* order, and the rule that a `401` must **not** be remembered as a permanent per-character refusal (that rule lives in `JanitorRefusedException.isTransient` / `_refusalError`, but is decided by the same reasoning).

Dart-only scaffolding: `Duration` constants, `Uri.pathSegments` semantics (a `?query` does not add segments — a JS `new URL(u).pathname.split('/')` must strip empty leading/trailing entries to match), pattern-matched `switch` expression.

Fragile:
- The allowlist is structural and will silently classify any new public endpoint as private (safe direction), but also silently classify a *future* account endpoint under `/hampter/characters/...` as public if it is two segments deep — e.g. `/hampter/characters/mine` would be allowed. (inferred)
- `startsWith('sb-') && contains('-auth-token')` also matches `sb-x-auth-token-backup` or any cookie whose name merely contains the substring (inferred; harmless for restore, but it means a parser must not assume chunk suffixes).
- Nothing validates that *all* chunks were restored; the failure mode ("logged out again") is only observable at the next 401.

## Open questions

- How JanitorAI's chunked cookie is actually assembled and decoded (prefix `base64-`, then base64 of session JSON) — not in this file; `_findTokenJs` in `services/janitor_webview_proxy.dart` (read for context) is the settlement.
- Whether `GET /hampter/tags` and `/hampter/characters/tags/suggest` are genuinely anonymous-readable — asserted in the doc comment, not verifiable from code.
- Whether any account endpoint is a GET under `/hampter/characters/{id}` with deeper paths that would slip through the allowlist — needs a list of endpoints; `janitor_provider.dart` and the widget layer would settle it.
- Dart compile-time question, not behavioural: `base64Url.decode(base64Url.normalize(parts[1]))` requires padding normalisation; whether a JWT chunk with `=` padding already present survives is not tested here.
