# cf_challenge_service.md
- **Path:** `C:/Users/Gedeon/Documents/Coding/Glaze-stable/lib/features/catalog/services/cf_challenge_service.dart`
- **Lines:** 117 (read in full, 1–117)
- **Role:** The process-wide coordinator/broker for Cloudflare's Turnstile challenge against janitorai.com — it parks a request, signals the UI to show a visible WebView, and hands back the resulting `cf_clearance` cookie together with the User-Agent it was minted under.

## Purpose

`CfChallengeService` is the *rendezvous* half of the Cloudflare machinery; it contains no WebView and no network code of its own. It exists so that the headless request engine (`JanitorWebViewProxy`) and the visible UI (`CatalogGrid`'s `_CfChallengeWebView`) can meet without knowing about each other: the engine calls `solve()` and blocks, the UI observes `isPending` and mounts a WebView, the WebView polls the cookie jar and calls `completeChallengeWith(cookie)`, `solve()` returns.

The documented flow, verbatim from the class doc:
```
///   1. [_janitorFetch] receives 403 → calls [solve].
///   2. [solve] flips [isPending] to `true` and blocks on a [Completer].
///   3. [CatalogGrid] reacts to [isPending] and shows an [InAppWebView].
///   4. The WebView finds `cf_clearance` → calls [completeChallengeWith].
///   5. [solve] returns the cookie, [_janitorFetch] retries.
```

It is a singleton (`CfChallengeService._(); static final CfChallengeService instance = CfChallengeService._();`), so the whole app shares one pending challenge.

## Behaviour walkthrough

- **Module-level logger:** `void _cfLog(String msg) => debugPrint('[CF] $msg');` — every log line in this file is prefixed `[CF] `.
- **Storage keys** (compile-time constants, shared `SharedPreferences`): `_cookieKey = 'gz_cf_clearance_janitor'`, `_expiryKey = 'gz_cf_expiry_janitor'`, `_uaKey = 'gz_cf_ua_janitor'`.
- **`cfBrowserUA`** — a module-level constant UA string:
  `'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'`
  documented as "Browser UA passed in every Dio request to janitorai.com. Must match what the challenge WebView sends, otherwise CF rejects the cookie." (Note: in the code as shipped this constant is *not* referenced from within this file; its consumers live elsewhere — see Open questions.)
- **Fields:** `isPending = ValueNotifier<bool>(false)` (public, observed by the UI), `String? _cached`, `String? _savedUA`, `Completer<String?>? _pending`.
- **`activeUA`** getter → `_savedUA`; **`setWebViewUA(String ua)`** → `_savedUA = ua`. Both `_CfChallengeWebView._onCreated` and `JanitorWebViewProxy._start().onWebViewCreated` call `setWebViewUA` with the value read from `navigator.userAgent` inside the page, so the UA recorded is the *native, post-override* UA of whichever WebView last ran.
- **`getCookie()`** — hot path: returns `_cached` when set. Otherwise reads `_cookieKey` and `_expiryKey` (default `0`) from prefs and returns the stored cookie **only if** `DateTime.now().millisecondsSinceEpoch < expiry`; on success it also does `_savedUA ??= prefs.getString(_uaKey)`. Expired or absent → `null` (no deletion; the stale value stays on disk).
- **`solve()`** — the blocking rendezvous:
  - If `_pending != null`, log `'solve() — reusing existing pending challenge'` and return `_pending!.future` (concurrent callers share one wait; **no second completer is created**).
  - Else log `'solve() — starting new challenge'`, create the `Completer<String?>`, store it in `_pending`, set `isPending.value = true`.
  - Await `c.future.timeout(const Duration(seconds: 90), onTimeout: () { _cfLog('solve() — TIMEOUT after 90s'); return null; })`.
  - `finally` always: `isPending.value = false; _pending = null;` — so a timed-out solve leaves no dangling completer and the next caller starts a fresh challenge.
  - Returns `String?` (null = no cookie). A per-caller timeout is layered on top by the caller (the proxy wraps its whole `_fetchLocked` in the `_gate`).
- **`completeChallengeWith(String? cookie)`** — called by the UI:
  - If `_pending == null || _pending!.isCompleted` → log `'completeChallengeWith() — no pending challenge, ignoring'` and return (this is what stops a late poll from resurrecting a solved/cancelled challenge).
  - Logs presence only, never the value: `'completeChallengeWith() — cookie=${cookie != null ? 'present' : 'null'}'`.
  - If `cookie != null` → `unawaited(_persist(cookie))` (fire-and-forget, so the waiter is released before the disk write completes).
  - `_pending!.complete(cookie)`.
- **`invalidate()`** — drops `_cached` and removes `_cookieKey` + `_expiryKey` from prefs asynchronously. Explicitly does **not** clear `_savedUA`, with the comment: "the WebView UA is an environment property that survives cookie invalidation and must stay consistent with the cf_clearance cookie that will be issued by the next challenge." Must be paired with `solve()` afterwards (which is exactly what `JanitorWebViewProxy._escalateToVisible` does: `invalidate(); await solve();`).
- **`_persist(String value)`** — `_cached = value`; `prefs.setString(_cookieKey, value)`; `if (_savedUA != null) prefs.setString(_uaKey, _savedUA!)`; `prefs.setInt(_expiryKey, now + 20 hours)`.

## Data shapes

- `isPending`: `ValueNotifier<bool>` → consumed as `ValueListenableBuilder<bool>` in `CatalogGrid`, which renders `_CfChallengeWebView` inside a `SizedBox(height: MediaQuery.of(context).size.height * 0.72)` while true.
- Cookie value: the raw `cf_clearance` string (opaque CF token, typically ~40+ chars; the UI logs only `value.substring(0, value.length.clamp(0, 40))`).
- `_pending` completes with `String?`: the cookie, or `null` on the 90 s timeout.
- Prefs entry types: `String` (cookie), `int` (epoch ms expiry), `String` (UA).

## Network / WebView contract

This file performs **no** network I/O and injects **no** JavaScript. The contract it defines is a handshake:

| Direction | Mechanism | Payload |
|---|---|---|
| UI → service | `setWebViewUA(ua)` | `navigator.userAgent` string read in-page |
| UI → `isPending` | `ValueNotifier` | drive mounting of a visible `InAppWebView` |
| service → UI | `solve()` awaits; UI polls cookie jar | — |
| UI → service | `completeChallengeWith(value)` | `cf_clearance` value or `null` |
| service → HTTP layer | `getCookie()` / `solve()` return | cookie string; `activeUA` for the UA header |

The actual challenge work happens in `_CfChallengeWebView` (`lib/features/catalog/widgets/catalog_grid.dart`, read for context): the visible WebView starts at `WebUri('about:blank')`, wipes **all** cookies, re-sets the `sb-…-auth-token` cookies it captured beforehand (`isJanitorAuthCookie`, `janitorAuthCookieExpiry`), navigates to `https://janitorai.com`, then polls `CookieManager.instance().getCookies(url: WebUri('https://janitorai.com'))` every **500 ms** and calls `completeChallengeWith(value)` on the first non-empty `cf_clearance`. It logs `'[CF] cf_clearance found on poll #$pollCount: …'`.

Inferred: because `_CfChallengeWebView` deletes every cookie except the restored auth cookies before navigating, the `cf_clearance` it harvests is always freshly minted and bound to the current WebView's UA — which is why `_savedUA` (not the pre-wipe UA) is what the HTTP layer must send.

## Selectors, regexes and string literals

- Prefs keys: `'gz_cf_clearance_janitor'`, `'gz_cf_expiry_janitor'`, `'gz_cf_ua_janitor'`.
- Cookie name checked by the consumer of the value: `'cf_clearance'`.
- UA literal: `'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'`.
- Log prefixes/strings: `'[CF] '`, `'solve() — reusing existing pending challenge'`, `'solve() — starting new challenge'`, `'solve() — TIMEOUT after 90s'`, `'solve() — completed, cookie=${… 'present' : 'null'}'`, `'completeChallengeWith() — no pending challenge, ignoring'`, `'completeChallengeWith() — cookie=…'`, `'invalidate() called'`.
- No regexes, no DOM selectors, no injected JS in this file.

## State machine, retries, timings

States: `idle` (`_pending == null`, `isPending == false`) → `pending` (`_pending != null`, `isPending == true`) → `resolved` (completer completed, `finally` nulls it) or `timed-out`.

- **Single-flight:** at most one challenge exists at a time; all concurrent callers await the same `Completer`.
- **Timeout:** exactly one, `const Duration(seconds: 90)`, applied with `Future.timeout(..., onTimeout: …)` returning `null` — it does **not** complete the completer with an error, so a late `completeChallengeWith` after a timeout hits the "no pending challenge, ignoring" branch.
- **No retries, no backoff, no attempt counter** in this file. Retry policy lives in `JanitorWebViewProxy._fetchLocked` (reload → escalate → reload → throw `JanitorCfException`).
- **Cache lifetime:** `DateTime.now().add(const Duration(hours: 20))` — a hard 20-hour TTL computed at persist time. Comment-free (no justification recorded inline; CF's own cookie lifetime for janitorai.com is not read back). Inferred: 20 h is a safety margin under CF's typical `cf_clearance` max-age.
- **Persistence race:** `_persist` is `unawaited`, so a process kill immediately after a solve can lose the cookie while `_cached` (in-memory) still holds it for the session.

## Errors and user-visible messages

No user-visible strings and no exceptions are thrown here — everything is `debugPrint` logs with the `[CF] ` prefix (listed above). Failure surfaces as `solve()`/`getCookie()` returning `null`; the caller turns that into `JanitorCfException(status)`, which the UI renders via `catalog_error_janitor_cloudflare` = `"JanitorAI is behind Cloudflare and did not return the character. Try another provider like Janny, DataCat, or Chub."`

Also note the deliberate non-clearing of `_savedUA` in `invalidate()`: forgetting it would silently reintroduce the "cookie present but CF 403s" state, which produces no error message at all — just a persistent 403.

## Persistence

| Key | Type | Written | Cleared |
|---|---|---|---|
| `gz_cf_clearance_janitor` | `String` — raw `cf_clearance` | `_persist` after each successful solve | `invalidate()` (async) |
| `gz_cf_expiry_janitor` | `int` — epoch ms, `now + 20 h` | `_persist` | `invalidate()` |
| `gz_cf_ua_janitor` | `String` — WebView UA | `_persist`, only when `_savedUA != null` | never cleared by this file |

Storage backend: `package:shared_preferences` (`SharedPreferences.getInstance()`), i.e. the platform key-value store (Android SharedPreferences XML, Windows/Desktop a prefs file, etc.). No tokens, no secrets beyond the CF cookie itself. `_cached` is a one-slot in-memory mirror that never expires within the process — after `getCookie()` succeeds once, subsequent calls skip the expiry check, so a cookie can outlive its prefs TTL for the session (inferred, and harmless: CF answers 403 and the caller reloads).

## Porting notes for our SillyTavern port

- **Nothing here is portable protocol** — it is an app-internal rendezvous. The ST extension equivalent is: `getCookie()` → read `cf_clearance` from a stored settings value (or `document.cookie` if the user runs the extension on a janitorai.com origin); `solve()` → prompt the user to open janitorai.com in a tab, solve the Turnstile, and paste the cookie + UA, or drive a same-origin iframe; `completeChallengeWith` → validate non-empty, store, and stamp an expiry.
- **Worth reproducing literally:** the three-way pairing of *(cookie, UA, expiry)*. A stored `cf_clearance` is worthless without the exact UA it was minted under, and this file's whole design encodes that: `activeUA` is exported precisely so the HTTP layer can send it, and `invalidate()` refuses to touch it. In the port, any "session reset" that drops the UA while keeping/re-fetching a cookie will produce unexplained 403s.
- **Reproduce the single-flight + 90 s semantics:** one pending challenge, concurrent callers share it, a timeout resolves to "no cookie" rather than throwing, and a late completion is ignored. That is what keeps a UI from stacking WebViews.
- **Dart-only scaffolding:** `ValueNotifier`, `SharedPreferences`, `unawaited`, `debugPrint`. In JS these become a tiny event emitter, `extensionSettings`, and plain assignment. The 20-hour TTL should be kept as a magic number unless the port reads CF's real `expires` from `Set-Cookie`.
- **Fragile:** the 20 h TTL is a guess (not derived from the cookie); the `_cached` short-circuit means an in-memory cookie is never re-validated; and `cfBrowserUA` pins `Chrome/136.0.0.0` — a hardcoded major that will drift out of alignment with any real browser's `Sec-CH-UA` client hints, which is exactly the mismatch the code's own comment warns about (see Open questions).

## Open questions

- `cfBrowserUA` is declared here but never referenced *in this file*; its consumer was not located during this read. Whether it is still used, or whether `activeUA` has fully replaced it, is UNKNOWN — not determined from this file; `grep -rn "cfBrowserUA" lib/` would settle it.
- Where the 20-hour TTL comes from (observed `cf_clearance` lifetime vs. arbitrary margin) is UNKNOWN — not determined from this file. A captured `Set-Cookie` for `cf_clearance` would settle it; `docs/` or the commit history may record it.
- Whether `getCookie()`'s returned cookie is ever used by a Dio/HTTP path that *also* sends `activeUA`, or whether in-WebView `fetch()` (which needs neither) made the cached-cookie path dead code, is UNKNOWN — not determined from this file; `janitor_provider.dart` and `catalog_http.dart` would settle it.
